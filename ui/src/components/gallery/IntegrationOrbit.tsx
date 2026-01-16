"use client";

import React from "react";
import { motion } from "framer-motion";

// Integration logos with accurate SVG paths from Simple Icons (https://simpleicons.org)
const integrations = [
  { 
    name: "Argo", 
    color: "#EF7B4D",
    // Argo CD logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M12.555.004a3.2 3.2 0 0 0-1.11 0C5.93.524 1.335 4.673.295 10.092c-.947 4.942 1.186 9.723 5.01 12.376.104.072.27.028.27-.103V20.32c0-.043-.02-.083-.053-.109-2.608-2.024-3.967-5.341-3.208-8.87C3.12 7.152 6.705 3.875 10.96 3.351c.136-.017.232.12.169.244L8.73 8.418c-.06.117.023.254.152.254h.838c.06 0 .116-.033.144-.087l3.087-5.874c.053-.1.2-.1.253 0l3.087 5.874a.163.163 0 0 0 .144.087h.838c.129 0 .212-.137.152-.254l-2.398-4.823c-.063-.124.033-.26.169-.244 4.255.524 7.839 3.8 8.645 8.088.76 3.53-.6 6.847-3.207 8.871-.034.026-.054.066-.054.109v2.045c0 .131.166.175.27.103 3.824-2.653 5.957-7.434 5.01-12.376-1.04-5.42-5.634-9.568-11.149-10.088a3.2 3.2 0 0 0-.555-.495zm-.555 8.65a.815.815 0 0 0-.815.814v6.22a.815.815 0 0 0 1.63 0v-6.22a.815.815 0 0 0-.815-.815z"/>
      </svg>
    )
  },
  { 
    name: "AWS", 
    color: "#232F3E",
    // Amazon AWS logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.18 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103a6.876 6.876 0 0 0-.862.272 2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 0 1 1.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586zm-3.24 1.214c.263 0 .534-.048.822-.144.287-.096.543-.271.758-.51.128-.152.224-.32.272-.512.047-.191.08-.423.08-.694v-.335a6.66 6.66 0 0 0-.735-.136 6.02 6.02 0 0 0-.75-.048c-.535 0-.926.104-1.19.32-.263.215-.39.518-.39.917 0 .375.095.655.295.846.191.2.47.296.838.296zm6.41.862c-.144 0-.24-.024-.304-.08-.064-.048-.12-.16-.168-.311L7.586 5.55a1.398 1.398 0 0 1-.072-.32c0-.128.064-.2.191-.2h.783c.151 0 .255.025.31.08.065.048.113.16.16.312l1.342 5.284 1.245-5.284c.04-.16.088-.264.151-.312a.549.549 0 0 1 .32-.08h.638c.152 0 .256.025.32.08.063.048.12.16.151.312l1.261 5.348 1.381-5.348c.048-.16.104-.264.16-.312a.52.52 0 0 1 .311-.08h.743c.127 0 .2.065.2.2 0 .04-.009.08-.017.128a1.137 1.137 0 0 1-.056.2l-1.923 6.17c-.048.16-.104.264-.168.312a.549.549 0 0 1-.311.08h-.687c-.151 0-.255-.024-.32-.08-.063-.056-.119-.16-.15-.32l-1.238-5.148-1.23 5.14c-.04.16-.087.264-.15.32-.065.056-.177.08-.32.08zm10.256.215c-.415 0-.83-.048-1.229-.143-.399-.096-.71-.2-.918-.32-.128-.071-.215-.151-.247-.223a.563.563 0 0 1-.048-.224v-.407c0-.167.064-.247.183-.247.048 0 .096.008.144.024.048.016.12.048.2.08.271.12.566.215.878.279.319.064.63.096.95.096.502 0 .894-.088 1.165-.264a.86.86 0 0 0 .415-.758.777.777 0 0 0-.215-.559c-.144-.151-.415-.287-.806-.415l-1.157-.36c-.583-.183-1.014-.454-1.277-.813a1.902 1.902 0 0 1-.4-1.158c0-.335.073-.63.216-.886.144-.255.335-.479.575-.654.24-.184.51-.32.83-.415.32-.096.655-.136 1.006-.136.175 0 .359.008.535.032.183.024.35.056.518.088.16.04.312.08.455.127.144.048.256.096.336.144a.69.69 0 0 1 .24.2.43.43 0 0 1 .071.263v.375c0 .168-.064.256-.184.256a.83.83 0 0 1-.303-.096 3.652 3.652 0 0 0-1.532-.311c-.455 0-.815.071-1.062.223-.248.152-.375.383-.375.71 0 .224.08.416.24.567.159.152.454.304.877.44l1.134.358c.574.184.99.44 1.237.767.247.327.367.702.367 1.117 0 .343-.072.655-.207.926-.144.272-.336.511-.583.703-.248.2-.543.343-.886.447-.36.111-.734.167-1.142.167zM21.698 16.207c-2.626 1.94-6.442 2.969-9.722 2.969-4.598 0-8.74-1.7-11.87-4.526-.246-.222-.026-.525.27-.353 3.384 1.963 7.559 3.153 11.877 3.153 2.914 0 6.114-.607 9.06-1.852.444-.2.816.287.385.61zM22.792 14.961c-.336-.43-2.22-.207-3.074-.103-.258.032-.298-.192-.063-.36 1.5-1.053 3.967-.75 4.254-.396.287.36-.08 2.826-1.485 4.007-.215.184-.423.088-.327-.151.32-.79 1.03-2.57.695-2.997z"/>
      </svg>
    )
  },
  { 
    name: "GitHub", 
    color: "#181717",
    // GitHub logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
      </svg>
    )
  },
  { 
    name: "Jira", 
    color: "#0052CC",
    // Jira logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z"/>
      </svg>
    )
  },
  { 
    name: "GitLab", 
    color: "#FC6D26",
    // GitLab logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="m23.6 9.593-.033-.086L20.3.98a.851.851 0 0 0-.336-.405.875.875 0 0 0-1.009.07.875.875 0 0 0-.29.44l-2.209 6.76H7.551l-2.21-6.76a.857.857 0 0 0-.29-.44.875.875 0 0 0-1.009-.07.858.858 0 0 0-.336.404L.437 9.507l-.033.086a6.066 6.066 0 0 0 2.012 7.01l.01.008.028.02 4.98 3.727 2.462 1.863 1.5 1.132a1.008 1.008 0 0 0 1.22 0l1.499-1.132 2.461-1.863 5.008-3.748.012-.01a6.062 6.062 0 0 0 2.004-7.007z"/>
      </svg>
    )
  },
  { 
    name: "Splunk", 
    color: "#000000",
    // Splunk logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="m1.5 24 7.556-4.41v-4.238L1.5 19.755ZM22.5 4.244l-7.556 4.403v4.246L22.5 8.482ZM9.056 24 1.5 19.755v-4.482l7.556 4.403Zm5.888-19.756L22.5 8.482V4.244l-7.556-4.237ZM1.5 4.237V8.49l7.556 4.403V8.647ZM22.5 19.762v-4.246l-7.556-4.41v4.247Z"/>
      </svg>
    )
  },
  { 
    name: "Confluence", 
    color: "#172B4D",
    // Confluence logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M.87 18.257c-.248.382-.53.875-.763 1.245a.764.764 0 0 0 .255 1.04l4.965 3.054a.764.764 0 0 0 1.058-.26c.199-.332.454-.763.733-1.221 1.967-3.247 3.945-2.853 7.508-1.146l4.957 2.412a.764.764 0 0 0 1.028-.382l2.1-4.9a.765.765 0 0 0-.378-1.006c-1.36-.663-4.014-1.974-6.152-3.02C8.66 10.68 4.343 12.002.87 18.257zM23.131 5.743c.249-.382.531-.875.764-1.246a.764.764 0 0 0-.256-1.04L18.674.404a.764.764 0 0 0-1.057.26c-.2.332-.455.763-.734 1.22-1.966 3.248-3.945 2.854-7.508 1.147L4.42.617a.764.764 0 0 0-1.028.382l-2.1 4.9a.765.765 0 0 0 .378 1.006c1.36.663 4.014 1.974 6.152 3.02 7.52 3.393 11.838 2.071 15.31-4.182z"/>
      </svg>
    )
  },
  { 
    name: "Webex", 
    color: "#000000",
    // Webex logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M11.9991 0C5.3832 0 0 5.3823 0 11.9991 0 18.6159 5.3832 24 11.9991 24 18.615 24 24 18.6168 24 11.9991 24 5.3814 18.6159 0 11.9991 0ZM8.7127 6.7509c.4697-.4706 1.2303-.4706 1.7.0009l1.8591 1.8654 2.1254-2.1318c.4688-.4715 1.2294-.4715 1.6991.0009.4697.4715.4697 1.2338 0 1.7053l-2.1263 2.1318 1.8627 1.869c.4679.4697.4679 1.2303-.0009 1.6991-.4697.4697-1.2312.4697-1.7.0009l-1.86-1.8654-2.1281 2.1318c-.4697.4724-1.2303.4724-1.7.0009-.4697-.4715-.4697-1.2329 0-1.7053l2.1272-2.1309-1.8591-1.8681c-.4706-.4688-.4706-1.2294 0-1.7Z"/>
      </svg>
    )
  },
  { 
    name: "Kubernetes", 
    color: "#326CE5",
    // Kubernetes logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M10.204 14.35l.007.01-.999 2.413a5.171 5.171 0 0 1-2.075-2.597l2.578-.437.004.005a.44.44 0 0 1 .485.606zm-.833-2.129a.44.44 0 0 0 .173-.756l.002-.011L7.585 9.7a5.143 5.143 0 0 1 .61 3.449l2.706.46-.004-.006a.436.436 0 0 0-.526-.382zm2.635 1.093a.44.44 0 0 0-.772-.323l-.007.008-1.707 1.826a5.174 5.174 0 0 0 2.486 1.087l.002-2.598zm1.988-6.3L12 8.997l-1.994-1.983 1.994-2.09 1.994 2.09zm.992 4.393l-.003-.007a.44.44 0 0 0-.772.323l.002 2.598a5.174 5.174 0 0 0 2.486-1.087l-1.713-1.827zm3.024-2.705a5.143 5.143 0 0 1 .61 3.449l-2.706.46.004-.006a.436.436 0 0 1 .526-.382.44.44 0 0 1 .173.756l-.002-.011 1.395 1.754-.001-.02zm-6.26 5.483l-1.997 2.084-1.997-2.084L12 12.142l1.75 1.943zM12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0z"/>
      </svg>
    )
  },
  { 
    name: "Slack", 
    color: "#4A154B",
    // Slack logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
      </svg>
    )
  },
  { 
    name: "Backstage", 
    color: "#9BF0E1",
    // Backstage (Spotify) logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.843 17.385c-.19 0-.38-.072-.526-.218a7.49 7.49 0 0 0-4.316-1.374 7.49 7.49 0 0 0-4.317 1.374.744.744 0 0 1-1.05-.098.744.744 0 0 1 .097-1.05 8.98 8.98 0 0 1 5.27-1.71 8.98 8.98 0 0 1 5.27 1.71.744.744 0 0 1-.428 1.366zm1.47-3.33c-.19 0-.38-.072-.527-.218A10.152 10.152 0 0 0 12 11.82a10.15 10.15 0 0 0-5.786 2.018.744.744 0 0 1-1.05-.098.744.744 0 0 1 .097-1.05A11.64 11.64 0 0 1 12 10.333c2.422 0 4.758.808 6.739 2.357a.744.744 0 0 1-.426 1.366zm1.514-3.536a.744.744 0 0 1-.527-.218A12.97 12.97 0 0 0 12 8.05c-2.874 0-5.65 1.022-7.8 2.877a.744.744 0 0 1-.952-1.148A14.46 14.46 0 0 1 12 6.565c3.2 0 6.29 1.14 8.753 3.214a.744.744 0 0 1-.426 1.366z"/>
      </svg>
    )
  },
  { 
    name: "AI", 
    color: "#FF6F61",
    // Robot/AI icon
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2m-4 9a1 1 0 0 0-1 1 1 1 0 0 0 1 1 1 1 0 0 0 1-1 1 1 0 0 0-1-1m8 0a1 1 0 0 0-1 1 1 1 0 0 0 1 1 1 1 0 0 0 1-1 1 1 0 0 0-1-1m-4 3c-1.1 0-2 .45-2 1s.9 1 2 1 2-.45 2-1-.9-1-2-1z"/>
      </svg>
    )
  },
  { 
    name: "Workflows", 
    color: "#FF9800",
    // Workflows/Tools icon
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
      </svg>
    )
  },
  { 
    name: "PagerDuty", 
    color: "#06AC38",
    // PagerDuty logo
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
        <path d="M16.965 1.18C15.085.164 13.769 0 10.683 0H3.73v14.55h6.926c2.743 0 4.8-.164 6.639-1.328 1.99-1.282 3.022-3.418 3.022-6.14 0-2.791-1.207-4.839-3.352-5.902zM10.232 10.8H8.14V3.756h2.258c3.142 0 4.922.901 4.922 3.418 0 2.721-1.78 3.627-5.088 3.627zM3.73 24h4.41v-6.705H3.73z"/>
      </svg>
    )
  },
];

// Outer orbit integrations (7 items)
const outerOrbit = integrations.slice(0, 7);
// Inner orbit integrations (7 items)
const innerOrbit = integrations.slice(7, 14);

export function IntegrationOrbit() {
  return (
    <div className="relative w-full h-[280px] flex items-center justify-center overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(173,80%,40%)]/10 via-transparent to-[hsl(270,75%,60%)]/10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
      
      {/* Connecting lines animation */}
      <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
        <defs>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(173,80%,40%)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="hsl(270,75%,60%)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="hsl(330,80%,55%)" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {/* Animated orbit rings */}
        <motion.circle
          cx="50%"
          cy="50%"
          r="90"
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="1"
          strokeDasharray="8 4"
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "center" }}
        />
        <motion.circle
          cx="50%"
          cy="50%"
          r="130"
          fill="none"
          stroke="url(#lineGradient)"
          strokeWidth="1"
          strokeDasharray="12 6"
          initial={{ rotate: 0 }}
          animate={{ rotate: -360 }}
          transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "center" }}
        />
      </svg>

      {/* Center CAIPE Logo */}
      <motion.div
        className="absolute z-20 w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(173,80%,40%)] via-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)] flex items-center justify-center shadow-2xl shadow-primary/50"
        animate={{
          scale: [1, 1.05, 1],
          boxShadow: [
            "0 0 30px rgba(var(--primary), 0.3)",
            "0 0 50px rgba(var(--primary), 0.5)",
            "0 0 30px rgba(var(--primary), 0.3)",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        <img src="/logo.svg" alt="CAIPE" className="w-12 h-12 filter brightness-0 invert" />
      </motion.div>

      {/* Inner Orbit - closer integrations */}
      <div className="absolute w-[180px] h-[180px]">
        <motion.div
          className="w-full h-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        >
          {innerOrbit.map((integration, index) => {
            const angle = (index * 360) / innerOrbit.length;
            const x = Math.cos((angle * Math.PI) / 180) * 90;
            const y = Math.sin((angle * Math.PI) / 180) * 90;
            
            return (
              <motion.div
                key={integration.name}
                className="absolute"
                style={{
                  left: `calc(50% + ${x}px - 18px)`,
                  top: `calc(50% + ${y}px - 18px)`,
                }}
                animate={{ rotate: -360 }}
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                whileHover={{ scale: 1.3, zIndex: 50 }}
              >
                <motion.div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg cursor-pointer group"
                  style={{ backgroundColor: integration.color }}
                  whileHover={{
                    boxShadow: `0 0 20px ${integration.color}80`,
                  }}
                  title={integration.name}
                >
                  <div className="w-5 h-5 text-white">
                    {integration.icon}
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Outer Orbit - wider spread */}
      <div className="absolute w-[260px] h-[260px]">
        <motion.div
          className="w-full h-full"
          animate={{ rotate: -360 }}
          transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
        >
          {outerOrbit.map((integration, index) => {
            const angle = (index * 360) / outerOrbit.length + 30; // Offset from inner
            const x = Math.cos((angle * Math.PI) / 180) * 130;
            const y = Math.sin((angle * Math.PI) / 180) * 130;
            
            return (
              <motion.div
                key={integration.name}
                className="absolute"
                style={{
                  left: `calc(50% + ${x}px - 20px)`,
                  top: `calc(50% + ${y}px - 20px)`,
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
                whileHover={{ scale: 1.3, zIndex: 50 }}
              >
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg cursor-pointer"
                  style={{ backgroundColor: integration.color }}
                  whileHover={{
                    boxShadow: `0 0 25px ${integration.color}80`,
                  }}
                  title={integration.name}
                >
                  <div className="w-6 h-6 text-white">
                    {integration.icon}
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Floating particles */}
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-primary/50"
          style={{
            left: `${20 + Math.random() * 60}%`,
            top: `${20 + Math.random() * 60}%`,
          }}
          animate={{
            y: [0, -20, 0],
            opacity: [0.3, 0.8, 0.3],
            scale: [1, 1.5, 1],
          }}
          transition={{
            duration: 2 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
    </div>
  );
}
