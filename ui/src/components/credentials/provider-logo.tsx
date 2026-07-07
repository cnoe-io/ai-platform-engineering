/**
 * Provider brand marks, shared so the credentials page and the project source
 * pickers render the same logos. GitHub / GitLab / PagerDuty are inline SVGs;
 * Atlassian and Webex come from `/public/provider-logos/*.svg`.
 */
export function ProviderLogo({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  switch (provider) {
    case "github":
      return (
        <svg aria-hidden="true" className={className ?? "h-6 w-6"} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.2-.02-2.18-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18A10.97 10.97 0 0 1 12 6.03c.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.79.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
        </svg>
      );
    case "atlassian":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          aria-hidden="true"
          className={className ?? "h-7 w-7 object-contain"}
          src="/provider-logos/atlassian.svg"
        />
      );
    case "webex":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          aria-hidden="true"
          className={className ?? "h-7 w-7 object-contain"}
          src="/provider-logos/webex.svg"
        />
      );
    case "pagerduty":
      return (
        <svg aria-hidden="true" className={className ?? "h-6 w-6"} viewBox="0 0 24 24" fill="currentColor">
          <path d="M5.25 2.25h7.65c3.66 0 6.45 2.68 6.45 6.22 0 3.62-2.79 6.32-6.45 6.32H9.64v6.96H5.25V2.25Zm7.17 8.76c1.52 0 2.55-1.02 2.55-2.48 0-1.42-1.03-2.41-2.55-2.41H9.64v4.89h2.78Z" />
        </svg>
      );
    case "gitlab":
      return (
        <svg aria-hidden="true" className={className ?? "h-7 w-7"} viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 21.15 3.95-12.17H8.05L12 21.15Z" opacity=".95" />
          <path d="M2.35 8.98 12 21.15 8.05 8.98H2.35Z" opacity=".72" />
          <path d="M21.65 8.98 12 21.15l3.95-12.17h5.7Z" opacity=".72" />
          <path d="M2.35 8.98 4.1 3.6c.18-.55.95-.55 1.13 0l2.82 5.38h-5.7ZM21.65 8.98 19.9 3.6c-.18-.55-.95-.55-1.13 0l-2.82 5.38h5.7Z" />
        </svg>
      );
    default:
      return <span aria-hidden="true" className="text-[10px] tracking-tight">OAuth</span>;
  }
}
