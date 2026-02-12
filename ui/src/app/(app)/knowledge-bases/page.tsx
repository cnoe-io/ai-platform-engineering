"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function KnowledgeBases() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to search by default
    router.replace("/knowledge-bases/search");
  }, [router]);

  return null;
}
