import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[react()],resolve:{alias:{'@':path.resolve('.')}},build:{outDir:'release/campaign-client',emptyOutDir:true,lib:{entry:'scripts/release/campaign-client.tsx',name:'RoleClueCampaign',formats:['iife'],fileName:()=> 'campaign-client.js'},rolldownOptions:{output:{codeSplitting:false}}}});
