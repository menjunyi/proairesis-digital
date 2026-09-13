import {createRoot} from 'react-dom/client';
import {BookingCalendar} from '../../components/booking-calendar';
const shell=document.querySelector('.booking-shell');
if(shell){const host=document.createElement('div');shell.replaceWith(host);createRoot(host).render(<BookingCalendar/>);}
