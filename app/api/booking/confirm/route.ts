import { bookingBridge } from '@/lib/booking-bridge.server';
export async function POST(request:Request) {
  if(Number(request.headers.get('content-length')||0)>4096) return Response.json({error:'Request too large.'},{status:413});
  let value;
  try { const text=await request.text();if(text.length>4096) throw new Error();value=JSON.parse(text); } catch {return Response.json({error:'Invalid request.'},{status:400});}
  if(!value || value.website || value.consent!==true || typeof value.name!=='string' || typeof value.email!=='string' || typeof value.date!=='string' || typeof value.start!=='string') return Response.json({error:'Check your details and consent.'},{status:400});
  return bookingBridge({action:'book',date:value.date,start:value.start,name:value.name,email:value.email},request);
}
