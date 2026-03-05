import Link from "next/link";
import { Globe } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="py-4 px-6">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Globe className="h-5 w-5 text-indigo-600" />
          <span className="font-bold text-gray-900">Deepglot</span>
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}
