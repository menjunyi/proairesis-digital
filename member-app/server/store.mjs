export class Conflict extends Error {}
export const MAX_ITEM_BYTES = 350 * 1024;
export const MAX_TRANSACTION_ACTIONS = 100;
export class RecordSizeError extends RangeError {
  constructor(){super('This record is too large. Shorten the resume, notes or document and try again.');this.status=413;this.code='RECORD_TOO_LARGE';}
}
export function assertRecordSize(item){if(Buffer.byteLength(JSON.stringify(item),'utf8')>MAX_ITEM_BYTES)throw new RecordSizeError();}
export function assertTransactionSize(changes){if(!Array.isArray(changes)||changes.length<1||changes.length>MAX_TRANSACTION_ACTIONS)throw new RangeError(`A transaction must contain between 1 and ${MAX_TRANSACTION_ACTIONS} actions.`);}
const itemFor=c=>({pk:c.pk,sk:c.sk,revision:c.expected+1,value:c.value,...(c.ttl?{ttl:c.ttl}:{})});
export class MemoryStore {
  constructor() { this.items = new Map(); }
  async get(pk, sk) { return structuredClone(this.items.get(`${pk}\0${sk}`) ?? null); }
  async list(pk, prefix = '') { return structuredClone([...this.items.values()].filter(x => x.pk === pk && x.sk.startsWith(prefix)).sort((a,b) => a.sk.localeCompare(b.sk))); }
  async listPage(pk, prefix = '', {after = null, limit = 50} = {}) {
    if(after!==null&&typeof after!=='string')throw new Error('Invalid page cursor');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid page limit');
    const rows=[...this.items.values()].filter(x=>x.pk===pk&&x.sk.startsWith(prefix)&&(after===null||x.sk>after)).sort((a,b)=>a.sk.localeCompare(b.sk));
    const items=rows.slice(0,limit),nextAfter=rows.length>limit?items.at(-1).sk:null;
    return structuredClone({items,nextAfter});
  }
  async scanPage({after = null, limit = 100} = {}) {
    if(after!==null&&(!after||typeof after!=='object'||Array.isArray(after)||typeof after.pk!=='string'||typeof after.sk!=='string'))throw new Error('Invalid scan cursor');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid page limit');
    const rows=[...this.items.values()].sort((a,b)=>a.pk.localeCompare(b.pk)||a.sk.localeCompare(b.sk));
    const filtered=after===null?rows:rows.filter(row=>row.pk>after.pk||row.pk===after.pk&&row.sk>after.sk);
    const items=filtered.slice(0,limit),last=items.at(-1),nextAfter=filtered.length>limit?{pk:last.pk,sk:last.sk}:null;
    return structuredClone({items,nextAfter});
  }
  async transact(changes) {
    assertTransactionSize(changes);
    for(const c of changes)if(!c.remove&&!c.checkOnly)assertRecordSize(itemFor(c));
    for (const c of changes) if ((this.items.get(`${c.pk}\0${c.sk}`)?.revision ?? 0) !== c.expected) throw new Conflict();
    for (const c of changes) { if(c.checkOnly)continue;const key = `${c.pk}\0${c.sk}`; if(c.remove) this.items.delete(key); else this.items.set(key,structuredClone(itemFor(c))); }
  }
  async removePartition(pk) { for (const [key,item] of this.items) if(item.pk === pk) this.items.delete(key); }
}

export class DynamoStore {
  constructor(client, table, commands) { this.client=client; this.table=table; this.commands=commands; }
  static async create(table) {
    const {DynamoDBClient}=await import('@aws-sdk/client-dynamodb');
    const commands=await import('@aws-sdk/lib-dynamodb');
    return new DynamoStore(commands.DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),table,commands);
  }
  async get(pk,sk) { const r=await this.client.send(new this.commands.GetCommand({TableName:this.table,Key:{pk,sk},ConsistentRead:true})); return r.Item??null; }
  async list(pk,prefix='') {
    const items=[]; let start;
    const keyCondition = prefix ? 'pk = :pk AND begins_with(sk, :prefix)' : 'pk = :pk';
    const values = {':pk':pk, ...(prefix ? {':prefix':prefix} : {})};
    do {
      const r = await this.client.send(new this.commands.QueryCommand({
        TableName:this.table, KeyConditionExpression:keyCondition,
        ExpressionAttributeValues:values, ExclusiveStartKey:start, ConsistentRead:true,
      }));
      items.push(...(r.Items??[])); start=r.LastEvaluatedKey;
      if(items.length>10000) throw new Error('Partition exceeds safe query size');
    } while(start);
    return items;
  }
  async listPage(pk,prefix='',{after=null,limit=50}={}) {
    if(after!==null&&typeof after!=='string')throw new Error('Invalid page cursor');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid page limit');
    const keyCondition=prefix?'pk = :pk AND begins_with(sk, :prefix)':'pk = :pk';
    const values={':pk':pk,...(prefix?{':prefix':prefix}:{})};
    const r=await this.client.send(new this.commands.QueryCommand({TableName:this.table,KeyConditionExpression:keyCondition,
      ExpressionAttributeValues:values,...(after?{ExclusiveStartKey:{pk,sk:after}}:{}),Limit:limit,ConsistentRead:true}));
    return {items:r.Items??[],nextAfter:r.LastEvaluatedKey?.sk??null};
  }
  async scanPage({after=null,limit=100}={}) {
    if(after!==null&&(!after||typeof after!=='object'||Array.isArray(after)||typeof after.pk!=='string'||typeof after.sk!=='string'))throw new Error('Invalid scan cursor');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid page limit');
    const r=await this.client.send(new this.commands.ScanCommand({TableName:this.table,...(after?{ExclusiveStartKey:after}:{}),Limit:limit,ConsistentRead:true}));
    return {items:r.Items??[],nextAfter:r.LastEvaluatedKey??null};
  }
  async transact(changes) {
    assertTransactionSize(changes);
    for(const c of changes)if(!c.remove&&!c.checkOnly)assertRecordSize(itemFor(c));
    try { await this.client.send(new this.commands.TransactWriteCommand({TransactItems:changes.map(c=>({[c.checkOnly?'ConditionCheck':c.remove?'Delete':'Put']:{TableName:this.table,...(c.remove||c.checkOnly?{Key:{pk:c.pk,sk:c.sk}}:{Item:itemFor(c)}),ConditionExpression:c.expected===0?'attribute_not_exists(pk)':'revision = :rev',...(c.expected===0?{}:{ExpressionAttributeValues:{':rev':c.expected}})}}))})); }
    catch(e) { if(e.name==='TransactionCanceledException' && e.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed')) throw new Conflict(); throw e; }
  }
  async removePartition(pk) { const items=await this.list(pk); for(let i=0;i<items.length;i+=25) { let requests=items.slice(i,i+25).map(x=>({DeleteRequest:{Key:{pk,sk:x.sk}}})); for(let retry=0;requests.length&&retry<8;retry++){ const r=await this.client.send(new this.commands.BatchWriteCommand({RequestItems:{[this.table]:requests}})); requests=r.UnprocessedItems?.[this.table]??[]; if(requests.length) await new Promise(resolve=>setTimeout(resolve,Math.min(1000,50*2**retry))); } if(requests.length) throw new Error('Deletion needs retry'); } }
}
export const change=(pk,sk,row,value)=>({pk,sk,expected:row?.revision??0,value,...(row?.ttl?{ttl:row.ttl}:{})});
export async function retryConflict(fn) { for(let attempt=0;attempt<12;attempt++){ try{return await fn();}catch(e){if(!(e instanceof Conflict)||attempt===11)throw e;} } }
