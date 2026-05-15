# ⚛️ Next.js 16 & UI Framework Rules

## 🛑 THIS IS NOT THE NEXT.JS YOU KNOW
This project uses **Next.js 16.x** and **React 19**. 
- This version has severe breaking changes compared to older versions in your training data.
- APIs, conventions, and file structures may differ. 
- *Directive:* Read the relevant guides in `node_modules/next/dist/docs/` before writing any complex routing or caching logic. Heed all deprecation notices.

## 1. Routing & Architecture
- Strictly adhere to the **App Router** (`src/app/`) architecture. Do NOT use `pages/` directory conventions.
- All Server Actions must be strictly typed and securely handled. Keep Client Components (`"use client"`) as close to the leaves of the component tree as possible to maximize server-side rendering.

## 2. UI & Styling (Tailwind v4)
- This project utilizes **Tailwind CSS v4**. Avoid deprecated utility classes.
- The aesthetic is "Flow-State Institutional" (Dark mode, high contrast, clean typography using the `Geist` font). Avoid generic retail trading UI elements.
- When generating UI, rely on the existing dashboard layout principles.

## 3. Charting Library Integration
- We use `lightweight-charts` for financial visualizations. 
- When updating the `Chart.tsx` or related components, ensure proper cleanup of chart instances on component unmount to prevent memory leaks and React Strict Mode double-render bugs.