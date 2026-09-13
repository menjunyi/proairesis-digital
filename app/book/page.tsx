import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RoleClueMark } from '@/components/roleclue-mark';
import { BookingCalendar } from '@/components/booking-calendar';
import './booking.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Let’s talk — RoleClue',description:'Book a conversation about your Australian job search.',robots:{index:false,follow:true}};
export default function BookingPage(){return <main className="roleclue-booking"><header className="booking-header"><Link href="/" className="booking-brand"><RoleClueMark className="size-9"/>RoleClue</Link><Link href="/" className="booking-home"><ArrowLeft size={15}/>Back to the website</Link></header><BookingCalendar/><footer className="booking-footer"><p>Built around your situation. Still in development.</p><p>A product conversation, not migration advice or a promise of employment. <Link href="/privacy">Privacy</Link></p></footer></main>;}
