// One-time wallet payments grant a fixed period only after Stripe verification.
export const PREPAID_OFFER='prepaid-aud20-50-30days-v1';
const id=v=>typeof v==='string'?v:v?.id;
export function prepaidActive(e,now=Date.now()){
 return e.prepaid?.status==='active'&&Boolean(e.prepaid.purchaseId)&&Date.parse(e.prepaid.periodEnd)>now;
}
export function prepaidMetadata(userSub,priceId,termsVersion){
 return {roleclue_user_id:userSub,roleclue_plan:'prepaid',roleclue_price_id:priceId,roleclue_offer:PREPAID_OFFER,terms_version:termsVersion+":prepaid-v1"};
}
export async function verifyPrepaid(s,sessionId,userSub,customerId,priceId,termsVersion){
 const session=await s.checkout.sessions.retrieve(sessionId,{expand:['line_items.data.price','payment_intent.latest_charge']});
 const meta=prepaidMetadata(userSub,priceId,termsVersion),matches=m=>Object.entries(meta).every(([k,v])=>m?.[k]===v);
 const items=session.line_items?.data,line=items?.[0];
 if(session.id!==sessionId||session.mode!=='payment'||session.status!=='complete'||session.payment_status!=='paid'
  ||id(session.customer)!==customerId||session.client_reference_id!==userSub||!matches(session.metadata)
  ||session.currency!=='aud'||session.amount_total!==2000||session.amount_subtotal!==2000||session.automatic_tax?.enabled!==false
  ||['amount_tax','amount_discount','amount_shipping'].some(k=>session.total_details?.[k]!==0)
  ||items?.length!==1||session.line_items.has_more!==false||line.quantity!==1||line.price?.currency!=='aud'
  ||line.price.unit_amount!==2000||line.price.recurring)return null;
 const catalog=await s.prices.retrieve(priceId);
 if(catalog.currency!=='aud'||catalog.unit_amount!==2000||catalog.recurring?.interval!=='month')return null;
 if(id(catalog.product)!==id(line.price.product)){
  const product=await s.products.retrieve(id(line.price.product));
  if(product.metadata?.roleclue_offer!==PREPAID_OFFER||product.metadata?.roleclue_source_product!==id(catalog.product)||product.name!=='RoleClue Plus — 30 days, pay once')return null;
 }
 let intent=session.payment_intent;if(typeof intent==='string')intent=await s.paymentIntents.retrieve(intent,{expand:['latest_charge']});
 let charge=intent?.latest_charge;if(typeof charge==='string')charge=await s.charges.retrieve(charge);
 if(intent?.status!=='succeeded'||id(intent.customer)!==customerId||!matches(intent.metadata)||intent.currency!=='aud'
  ||intent.amount!==2000||intent.amount_received!==2000||charge?.status!=='succeeded'||charge.paid!==true||charge.captured!==true
  ||id(charge.customer)!==customerId||charge.currency!=='aud'||charge.amount!==2000||charge.amount_captured!==2000
  ||id(charge.payment_intent)!==intent.id||!Number.isSafeInteger(charge.created)||charge.created<=0)return null;
 return {key:session.id,sessionId:session.id,purchaseId:intent.id,status:charge.disputed?'disputed':charge.refunded||charge.amount_refunded>0?'refunded':'active',everPaid:true,
  periodStart:new Date(charge.created*1000).toISOString(),periodEnd:new Date((charge.created+30*86400)*1000).toISOString()};
}
export async function findPrepaid(s,e,userSub,priceId,termsVersion){
 const ids=[];let after;
 for(let page=0;page<10;page++){
  const r=await s.checkout.sessions.list({customer:e.customerId,status:'complete',limit:100,...(after?{starting_after:after}:{})});
  for(const x of r.data)if(x.metadata?.roleclue_plan==='prepaid')ids.push(x.id);
  if(!r.has_more)break;
  const next=r.data.at(-1)?.id;if(!next||next===after||page===9)throw Error('Prepaid history needs support review');after=next;
 }
 if(e.prepaid?.sessionId&&!ids.includes(e.prepaid.sessionId))ids.push(e.prepaid.sessionId);
 const verified=[];
 for(const sessionId of ids){const p=await verifyPrepaid(s,sessionId,userSub,e.customerId,priceId,termsVersion);if(p)verified.push(p);}
 verified.sort((a,b)=>b.periodStart.localeCompare(a.periodStart)||b.key.localeCompare(a.key));return verified[0]??null;
}
