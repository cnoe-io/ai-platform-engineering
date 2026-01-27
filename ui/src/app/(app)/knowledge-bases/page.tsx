"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function KnowledgeBases() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to ingest by default
    router.replace("/knowledge-bases/ingest");
  }, [router]);

  return null;
}
