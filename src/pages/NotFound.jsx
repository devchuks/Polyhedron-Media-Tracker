import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

export const NotFound = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-in fade-in duration-300">
    <AlertCircle className="w-16 h-16 text-error mb-4 opacity-80" />
    <h1 className="text-4xl font-black uppercase tracking-widest font-sans text-primary mb-2">404</h1>
    <h2 className="text-xl font-bold uppercase tracking-wide font-sans mb-4">Sector Not Found</h2>
    <p className="text-xs font-mono text-base-content/60 max-w-md mb-8">
      The coordinates you requested do not exist in the current directory. 
      Please verify your routing parameters and try again.
    </p>
    <Link to="/" className="btn btn-primary rounded-none font-mono text-[10px] uppercase tracking-widest px-8">
      Return to Dashboard
    </Link>
  </div>
);