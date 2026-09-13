import {defineConfig} from 'vite';
export default defineConfig({build:{outDir:'release/client',emptyOutDir:true,lib:{entry:'scripts/release/booking-client.tsx',name:'RoleClueBooking',formats:['iife'],fileName:()=> 'booking-client.js'},rolldownOptions:{output:{codeSplitting:false}}},define:{'process.env.NODE_ENV':JSON.stringify('production')}});
