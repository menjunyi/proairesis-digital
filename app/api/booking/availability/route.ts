import { bookingBridge } from '@/lib/booking-bridge.server';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const date=new URL(request.url).searchParams.get('date');
  if(!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({error:'Choose a valid date.'},{status:400});
  return bookingBridge({action:'availability',date},request);
}
