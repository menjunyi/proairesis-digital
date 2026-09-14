import {createRoot} from 'react-dom/client';
import {CampaignTracker} from '../../components/campaign-tracker';
const root=document.getElementById('campaign-analytics');
if(root)createRoot(root).render(<CampaignTracker/>);
