export async function bookingBridge(payload: Record<string, unknown>, request: Request) {
  const endpoint = process.env.BOOKING_BRIDGE_URL?.trim();
  const secret = process.env.BOOKING_BRIDGE_SECRET?.trim();
  if (!endpoint || !secret) return Response.json({error:'Online booking is being connected. Please check back shortly.',connected:false},{status:503});
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) return Response.json({error:'Booking is temporarily unavailable.'},{status:503});
  const origin = request.headers.get('origin');
  if (request.method==='POST' && origin!==new URL(request.url).origin) return Response.json({error:'Invalid request origin.'},{status:403});
  const ip=request.headers.get('cf-connecting-ip') || 'local';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret+ip));
  const client=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  try {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,client,secret}),signal:AbortSignal.timeout(25000)});
    if(!response.ok) throw new Error('Unavailable');
    const data=await response.json() as {ok?:boolean;slots?:string[];start?:string;meetUrl?:string;error?:string};
    if(!data.ok) return Response.json({error:data.error || 'Booking is temporarily unavailable.'},{status:409,headers:{'Cache-Control':'no-store'}});
    return Response.json(payload.action==='availability'?{slots:data.slots,timeZone:'Australia/Sydney',connected:true}:{confirmed:true,start:data.start,meetUrl:data.meetUrl},{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'We could not reach the calendar. Please try again. If you received an invitation, your booking was created.'},{status:503}); }
}
