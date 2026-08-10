"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function KnowledgeBases() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to search by default
    router.replace("/knowledge-bases/search");
  }, [router]);

  return null;
}
