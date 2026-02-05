"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to workflows (agent-builder) by default
    router.replace("/agent-builder");
  }, [router]);

  return null;
}
