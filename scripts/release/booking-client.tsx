import {createRoot} from 'react-dom/client';
import {OpinionForm} from '../../components/opinion-form';
import {BookingCalendar} from '../../components/booking-calendar';
const shell=document.querySelector('.booking-shell');
if(shell){const host=document.createElement('div');shell.replaceWith(host);createRoot(host).render(<BookingCalendar/>);}

// The opinion form is independent of calendar selection and confirmation.
const opinion=document.querySelector('.opinion-section');
if(opinion){const host=document.createElement('div');opinion.replaceWith(host);createRoot(host).render(<OpinionForm/>);}
