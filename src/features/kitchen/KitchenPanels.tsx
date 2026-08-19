import React from 'react';
import { BarChart3 } from 'lucide-react';

export const Heading: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-[#B91C1C] text-white flex items-center justify-center">{icon || <BarChart3 className="w-5 h-5" />}</div><div><h2 className="text-lg font-extrabold">{title}</h2>{subtitle && <p className="text-xs text-[#57534E]">{subtitle}</p>}</div></div>
);

export const Panel: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => <div className="bg-white rounded-2xl p-4 border border-[#E7E5E4] shadow-xs">{title && <h3 className="text-sm font-extrabold mb-3">{title}</h3>}{children}</div>;

export const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-xs text-[#A8A29E] italic py-5 text-center">{text}</p>;
