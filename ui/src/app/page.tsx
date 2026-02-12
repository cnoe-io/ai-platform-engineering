"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to skills by default
    router.replace("/skills");
  }, [router]);

  return null;
}
