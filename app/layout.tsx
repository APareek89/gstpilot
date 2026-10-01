import type { Metadata } from 'next';
import { AccountShell } from '@/components/AccountShell';
import './globals.css';
export const metadata: Metadata = { title: 'GSTPilot — GST questions and filing facts', description: 'Explore GST questions with cited sources and a bounded historical filing example. Information, not professional advice.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" className="lovable-ui" data-theme="light" suppressHydrationWarning><body><AccountShell>{children}</AccountShell></body></html>; }
