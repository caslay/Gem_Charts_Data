import os

files = [
    r"C:\My Files\Work\Lab\Gem_Charts_Data\src\components\Sidebar.tsx",
    r"C:\My Files\Work\Lab\Gem_Charts_Data\src\components\NavigationHeader.tsx",
    r"C:\My Files\Work\Lab\Gem_Charts_Data\src\components\MatrixConfigDrawer.tsx",
    r"C:\My Files\Work\Lab\Gem_Charts_Data\src\app\page.tsx",
    r"C:\My Files\Work\Lab\Gem_Charts_Data\src\components\Chart.tsx",
]

replacements = {
    # Borders (do this first to prevent partial replacements)
    "border-zinc-800": "border-[#4a4457]/50",
    "border-zinc-900": "border-[#4a4457]/50",
    "border-gray-800": "border-[#4a4457]/50",
    "border-white/5": "border-[#4a4457]/50",
    "border-white/10": "border-[#4a4457]/50",
    "border-white/20": "border-[#4a4457]/50",

    # Backgrounds
    "bg-[#0a0a0a]": "bg-[#0e0e0f]",
    "bg-[#000000]": "bg-[#1c1b1c]",
    "bg-[#050505]": "bg-[#1c1b1c]",
    "bg-[#141415]": "bg-[#1c1b1c]",
    "bg-[#080808]": "bg-[#1c1b1c]",
    "bg-[#0f0f0f]": "bg-[#1c1b1c]",
    "bg-black": "bg-[#0e0e0f]",
    "bg-zinc-950": "bg-[#0e0e0f]",
    "bg-zinc-900": "bg-[#1c1b1c]",
    
    # Accents
    "cyan-500": "[#d1bcff]",
    "cyan-400": "[#d1bcff]",
    "cyan-600": "[#d1bcff]",
    "cyan-300": "[#d1bcff]",
    "cyan-900": "[#d1bcff]",
    "blue-500": "[#d1bcff]",
    "blue-600": "[#d1bcff]",
    
    "emerald-500": "[#50ffaf]",
    "emerald-400": "[#50ffaf]",
    "emerald-950": "[#50ffaf]",
    "green-500": "[#50ffaf]",
    
    "red-500": "[#ffb4ab]",
    "red-400": "[#ffb4ab]",
    
    "yellow-500": "[#ffb2bb]",
    "yellow-400": "[#ffb2bb]",
    
    # Texts
    "text-white": "text-[#e5e2e3]",
    "text-zinc-100": "text-[#e5e2e3]",
    "text-zinc-200": "text-[#e5e2e3]",
    "text-zinc-300": "text-[#e5e2e3]",
    "text-gray-200": "text-[#e5e2e3]",
    "text-gray-300": "text-[#e5e2e3]",
    
    "text-zinc-400": "text-[#958da3]",
    "text-zinc-500": "text-[#958da3]",
    "text-zinc-600": "text-[#958da3]",
    "text-zinc-700": "text-[#958da3]",
    "text-gray-400": "text-[#958da3]",
    "text-gray-500": "text-[#958da3]",
    
    "hover:text-white": "hover:text-[#e5e2e3]",
    
    "scrollbar-thumb-zinc-800": "scrollbar-thumb-[#4a4457]/50",
}

for f in files:
    if not os.path.exists(f):
        print(f"Skipping {f}, not found")
        continue
        
    with open(f, "r", encoding="utf-8") as file:
        content = file.read()
    
    # Chart.tsx specific replacements
    if "Chart.tsx" in f:
        content = content.replace("backgroundColor = '#000000'", "backgroundColor = '#0e0e0f'")
        content = content.replace("textColor = '#9CA3AF'", "textColor = '#958da3'")
        content = content.replace("upColor = '#22d3ee'", "upColor = '#50ffaf'")
        content = content.replace("downColor = '#c084fc'", "downColor = '#ffb4ab'")
        content = content.replace("'rgba(255, 255, 255, 0.05)'", "'rgba(74, 68, 87, 0.5)'")
        content = content.replace("'rgba(255, 255, 255, 0.1)'", "'rgba(74, 68, 87, 0.5)'")
        content = content.replace("'rgba(255, 255, 255, 0.2)'", "'rgba(74, 68, 87, 0.5)'")
    else:
        for old, new in replacements.items():
            content = content.replace(old, new)
        
    with open(f, "w", encoding="utf-8") as file:
        file.write(content)

print("Replacement complete.")
