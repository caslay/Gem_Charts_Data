import type { MetadataRoute } from "next";
import { SYSTEM_VERSION } from "@/lib/version";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quegar",
    short_name: "Quegar",
    description: "Quegar Portal",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "any",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
}
