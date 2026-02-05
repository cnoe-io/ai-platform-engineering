import { useState, useEffect } from "react";

interface VersionInfo {
  version: string;
  gitCommit: string;
  buildDate: string;
  packageVersion?: string;
}

export function useVersion() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch("/api/version");
        if (response.ok) {
          const data = await response.json();
          setVersionInfo(data);
        }
      } catch (error) {
        console.error("Failed to fetch version info:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVersion();
  }, []);

  return { versionInfo, isLoading };
}
