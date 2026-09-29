import type { MaterialCategory, MaterialDef, ProceduralKind } from '../model/types'

/**
 * Built-in material library (§16). Textures are generated procedurally at runtime (offline, no
 * image assets), so every entry is a small recipe: pattern kind + palette + physical params.
 */

interface Recipe {
  id: string
  name: string
  category: MaterialCategory
  kind: ProceduralKind
  colors: string[]
  /** Real-world size of one texture repeat (m). */
  scale: number
  roughness: number
  metalness?: number
  reflection?: number
  opacity?: number
  params?: Record<string, number>
}

const R: Recipe[] = [
  // Marble
  { id: 'marble-carrara', name: 'Carrara White', category: 'marble', kind: 'marble', colors: ['#eeeeec', '#b9bcbf', '#8e9297'], scale: 1.2, roughness: 0.14, reflection: 0.6, params: { veins: 0.55, tile: 0.6 } },
  { id: 'marble-calacatta', name: 'Calacatta Gold', category: 'marble', kind: 'marble', colors: ['#f3f1ec', '#c7b58d', '#9b8a66'], scale: 1.6, roughness: 0.12, reflection: 0.65, params: { veins: 0.8, tile: 0 } },
  { id: 'marble-ziarat', name: 'Ziarat White', category: 'marble', kind: 'marble', colors: ['#f1efe9', '#d9d4ca', '#c3bcae'], scale: 1.0, roughness: 0.15, reflection: 0.55, params: { veins: 0.25, tile: 0.6 } },
  { id: 'marble-botticino', name: 'Botticino Beige', category: 'marble', kind: 'marble', colors: ['#e5d8c1', '#cbb89a', '#b19c7c'], scale: 1.0, roughness: 0.18, reflection: 0.5, params: { veins: 0.35, tile: 0.6 } },
  { id: 'marble-sunny-grey', name: 'Sunny Grey', category: 'marble', kind: 'marble', colors: ['#cfcdc8', '#a9a6a0', '#8a867f'], scale: 1.0, roughness: 0.18, reflection: 0.5, params: { veins: 0.45, tile: 0.6 } },
  { id: 'marble-nero', name: 'Nero Marquina', category: 'marble', kind: 'marble', colors: ['#1d1e20', '#dcdcdc', '#6d6f72'], scale: 1.4, roughness: 0.12, reflection: 0.7, params: { veins: 0.6, tile: 0.6 } },
  { id: 'marble-emperador', name: 'Emperador Brown', category: 'marble', kind: 'marble', colors: ['#5b3f2c', '#c8a888', '#3d2a1d'], scale: 1.2, roughness: 0.16, reflection: 0.55, params: { veins: 0.7, tile: 0.6 } },
  { id: 'marble-verde', name: 'Verde Guatemala', category: 'marble', kind: 'marble', colors: ['#1f3b30', '#9fbfaa', '#10231b'], scale: 1.2, roughness: 0.14, reflection: 0.6, params: { veins: 0.75, tile: 0 } },
  { id: 'marble-onyx', name: 'Honey Onyx', category: 'marble', kind: 'marble', colors: ['#e6b86b', '#fff1cf', '#b77b2d'], scale: 1.4, roughness: 0.1, reflection: 0.7, params: { veins: 0.9, tile: 0 } },
  // Granite
  { id: 'granite-black-galaxy', name: 'Black Galaxy', category: 'granite', kind: 'granite', colors: ['#141517', '#2a2b2e', '#c9a86a'], scale: 0.8, roughness: 0.12, reflection: 0.7, params: { speck: 0.08 } },
  { id: 'granite-absolute-black', name: 'Absolute Black', category: 'granite', kind: 'granite', colors: ['#18191b', '#232427', '#3a3b3f'], scale: 0.8, roughness: 0.1, reflection: 0.75, params: { speck: 0.2 } },
  { id: 'granite-grey-sardo', name: 'Grey Sardo', category: 'granite', kind: 'granite', colors: ['#9b9a98', '#5d5c5b', '#dcdad6'], scale: 0.6, roughness: 0.2, reflection: 0.5, params: { speck: 0.45 } },
  { id: 'granite-ruby-red', name: 'Ruby Red', category: 'granite', kind: 'granite', colors: ['#7a2f2a', '#3b1715', '#c77d6f'], scale: 0.6, roughness: 0.2, reflection: 0.5, params: { speck: 0.4 } },
  { id: 'granite-tan-brown', name: 'Tan Brown', category: 'granite', kind: 'granite', colors: ['#4a3528', '#1f1814', '#a7775a'], scale: 0.6, roughness: 0.18, reflection: 0.55, params: { speck: 0.4 } },
  // Ceramic
  { id: 'ceramic-white-gloss', name: 'White Gloss 30×60', category: 'ceramic', kind: 'tiles', colors: ['#f4f4f2', '#dcdcda'], scale: 0.6, roughness: 0.08, reflection: 0.5, params: { tw: 0.3, th: 0.6, grout: 0.003, noise: 0.02 } },
  { id: 'ceramic-grey-matte', name: 'Grey Matte 60×60', category: 'ceramic', kind: 'tiles', colors: ['#a6a7a6', '#8b8c8b'], scale: 1.2, roughness: 0.7, reflection: 0.1, params: { tw: 0.6, th: 0.6, grout: 0.003, noise: 0.08 } },
  { id: 'ceramic-subway', name: 'Subway White', category: 'ceramic', kind: 'tiles', colors: ['#f2f1ee', '#cfcfcb'], scale: 0.3, roughness: 0.1, reflection: 0.45, params: { tw: 0.15, th: 0.075, grout: 0.003, stagger: 1, noise: 0.03 } },
  { id: 'ceramic-blue-mosaic', name: 'Blue Mosaic', category: 'ceramic', kind: 'tiles', colors: ['#3f7fa3', '#d9e4ea'], scale: 0.3, roughness: 0.15, reflection: 0.4, params: { tw: 0.025, th: 0.025, grout: 0.002, noise: 0.35 } },
  { id: 'ceramic-moroccan', name: 'Encaustic Pattern', category: 'ceramic', kind: 'tiles', colors: ['#e9e4d8', '#2f4f6b'], scale: 0.4, roughness: 0.4, reflection: 0.2, params: { tw: 0.2, th: 0.2, grout: 0.002, motif: 1 } },
  // Porcelain
  { id: 'porcelain-ivory', name: 'Ivory 60×120', category: 'porcelain', kind: 'tiles', colors: ['#ece7dc', '#d9d2c3'], scale: 1.2, roughness: 0.25, reflection: 0.35, params: { tw: 0.6, th: 1.2, grout: 0.002, noise: 0.05 } },
  { id: 'porcelain-concrete-grey', name: 'Concrete Grey 60×60', category: 'porcelain', kind: 'tiles', colors: ['#9e9d99', '#85847f'], scale: 1.2, roughness: 0.55, reflection: 0.15, params: { tw: 0.6, th: 0.6, grout: 0.002, noise: 0.12 } },
  { id: 'porcelain-statuario', name: 'Statuario Slab', category: 'porcelain', kind: 'marble', colors: ['#f5f5f3', '#a9abad', '#6f7275'], scale: 1.2, roughness: 0.1, reflection: 0.6, params: { veins: 0.65, tile: 1.2 } },
  { id: 'porcelain-black-matte', name: 'Black Matte 60×60', category: 'porcelain', kind: 'tiles', colors: ['#2a2a2b', '#1f1f20'], scale: 1.2, roughness: 0.6, reflection: 0.15, params: { tw: 0.6, th: 0.6, grout: 0.002, noise: 0.05 } },
  { id: 'porcelain-outdoor', name: 'Outdoor Anti-slip', category: 'porcelain', kind: 'tiles', colors: ['#b4ab9c', '#9a917f'], scale: 1.2, roughness: 0.85, reflection: 0.05, params: { tw: 0.6, th: 0.6, grout: 0.004, noise: 0.18 } },
  { id: 'porcelain-wood-look', name: 'Wood-look Plank', category: 'porcelain', kind: 'wood', colors: ['#a57a52', '#7d5638', '#c69a6e'], scale: 1.2, roughness: 0.45, reflection: 0.2, params: { plank: 0.2, length: 1.2 } },
  // Wood
  { id: 'wood-oak', name: 'Natural Oak', category: 'wood', kind: 'wood', colors: ['#b8875a', '#8f6441', '#d2a579'], scale: 1.6, roughness: 0.45, reflection: 0.25, params: { plank: 0.19, length: 1.6 } },
  { id: 'wood-walnut', name: 'Walnut', category: 'wood', kind: 'wood', colors: ['#5e3f2a', '#3f2819', '#7b5639'], scale: 1.6, roughness: 0.4, reflection: 0.3, params: { plank: 0.18, length: 1.6 } },
  { id: 'wood-teak', name: 'Teak', category: 'wood', kind: 'wood', colors: ['#9c6a3c', '#734a26', '#b7834f'], scale: 1.6, roughness: 0.42, reflection: 0.28, params: { plank: 0.14, length: 1.4 } },
  { id: 'wood-maple', name: 'Light Maple', category: 'wood', kind: 'wood', colors: ['#dcc19c', '#c4a47d', '#ead3b2'], scale: 1.6, roughness: 0.45, reflection: 0.22, params: { plank: 0.19, length: 1.6 } },
  { id: 'wood-wenge', name: 'Wenge', category: 'wood', kind: 'wood', colors: ['#3a2a21', '#241912', '#56402f'], scale: 1.6, roughness: 0.4, reflection: 0.3, params: { plank: 0.16, length: 1.4 } },
  { id: 'wood-herringbone', name: 'Oak Herringbone', category: 'wood', kind: 'parquet', colors: ['#b98a5c', '#96693f', '#d0a476'], scale: 0.8, roughness: 0.42, reflection: 0.28, params: { plank: 0.09, length: 0.45 } },
  { id: 'wood-deck', name: 'Outdoor Deck', category: 'wood', kind: 'wood', colors: ['#8a6547', '#6b4b33', '#a07a57'], scale: 1.8, roughness: 0.7, reflection: 0.05, params: { plank: 0.14, length: 1.8, gap: 1 } },
  // Concrete
  { id: 'concrete-smooth', name: 'Smooth Concrete', category: 'concrete', kind: 'concrete', colors: ['#a3a29d', '#8e8d88'], scale: 2.0, roughness: 0.75, reflection: 0.08 },
  { id: 'concrete-polished', name: 'Polished Concrete', category: 'concrete', kind: 'concrete', colors: ['#9fa09e', '#86878a'], scale: 2.0, roughness: 0.25, reflection: 0.4 },
  { id: 'concrete-board', name: 'Board-formed', category: 'concrete', kind: 'concrete', colors: ['#9a9893', '#7f7d78'], scale: 1.5, roughness: 0.85, reflection: 0.05, params: { boards: 0.15 } },
  { id: 'terrazzo-classic', name: 'Terrazzo', category: 'concrete', kind: 'terrazzo', colors: ['#e8e4dc', '#7d7a74', '#b3553f', '#3c5d6b'], scale: 0.8, roughness: 0.2, reflection: 0.45 },
  // Brick
  { id: 'brick-red', name: 'Red Facing Brick', category: 'brick', kind: 'brick', colors: ['#9a4a33', '#7b3824', '#b8623f', '#cfc5b6'], scale: 0.9, roughness: 0.85, reflection: 0.05, params: { bw: 0.228, bh: 0.076, mortar: 0.01 } },
  { id: 'brick-gutka', name: 'Gutka Tile', category: 'brick', kind: 'brick', colors: ['#b8674a', '#a1573c', '#cd8363', '#d9d2c4'], scale: 0.9, roughness: 0.8, reflection: 0.05, params: { bw: 0.228, bh: 0.057, mortar: 0.008 } },
  { id: 'brick-white', name: 'Whitewashed Brick', category: 'brick', kind: 'brick', colors: ['#e7e3dc', '#cfc9bf', '#f3f0ea', '#bdb6aa'], scale: 0.9, roughness: 0.85, reflection: 0.05, params: { bw: 0.228, bh: 0.076, mortar: 0.01 } },
  { id: 'brick-clinker', name: 'Dark Clinker', category: 'brick', kind: 'brick', colors: ['#3d302b', '#2b211d', '#58463d', '#6e6861'], scale: 0.9, roughness: 0.7, reflection: 0.1, params: { bw: 0.24, bh: 0.052, mortar: 0.01 } },
  // Stone
  { id: 'stone-travertine', name: 'Travertine', category: 'stone', kind: 'stone', colors: ['#d8c7a8', '#bfa985', '#e8dbc3'], scale: 1.2, roughness: 0.55, reflection: 0.2, params: { pores: 1, tile: 0.6 } },
  { id: 'stone-sandstone', name: 'Sandstone Cladding', category: 'stone', kind: 'stone', colors: ['#c9a57a', '#a9845a', '#dcc09a'], scale: 1.2, roughness: 0.85, reflection: 0.05, params: { ashlar: 1 } },
  { id: 'stone-ledgestone', name: 'Ledgestone Cladding', category: 'stone', kind: 'stone', colors: ['#8f8a80', '#6b665e', '#b3aea3'], scale: 1.0, roughness: 0.9, reflection: 0.05, params: { ledge: 1 } },
  { id: 'stone-slate', name: 'Slate', category: 'stone', kind: 'slate', colors: ['#4a5055', '#383d41', '#626970'], scale: 1.2, roughness: 0.7, reflection: 0.15 },
  { id: 'stone-limestone', name: 'Limestone', category: 'stone', kind: 'stone', colors: ['#e0d8c8', '#cbc1ad', '#ece6da'], scale: 1.2, roughness: 0.6, reflection: 0.1, params: { tile: 0.9 } },
  { id: 'stone-basalt', name: 'Basalt', category: 'stone', kind: 'slate', colors: ['#3b3c3e', '#2c2d2f', '#4c4d50'], scale: 1.2, roughness: 0.65, reflection: 0.15 },
  // Paint & plaster
  { id: 'paint-warm-white', name: 'Warm White', category: 'paint', kind: 'plaster', colors: ['#f1ede4'], scale: 2, roughness: 0.9 },
  { id: 'paint-ceiling', name: 'Ceiling White', category: 'paint', kind: 'plaster', colors: ['#f6f5f2'], scale: 2, roughness: 0.95 },
  { id: 'paint-off-white', name: 'Off White', category: 'paint', kind: 'plaster', colors: ['#e9e4d9'], scale: 2, roughness: 0.9 },
  { id: 'paint-beige', name: 'Sand Beige', category: 'paint', kind: 'plaster', colors: ['#d9c8ad'], scale: 2, roughness: 0.9 },
  { id: 'paint-greige', name: 'Greige', category: 'paint', kind: 'plaster', colors: ['#c3bbb0'], scale: 2, roughness: 0.9 },
  { id: 'paint-light-grey', name: 'Light Grey', category: 'paint', kind: 'plaster', colors: ['#cfd1d2'], scale: 2, roughness: 0.9 },
  { id: 'paint-charcoal', name: 'Charcoal', category: 'paint', kind: 'plaster', colors: ['#3e4144'], scale: 2, roughness: 0.85 },
  { id: 'paint-sage', name: 'Sage Green', category: 'paint', kind: 'plaster', colors: ['#a7b29a'], scale: 2, roughness: 0.9 },
  { id: 'paint-navy', name: 'Deep Navy', category: 'paint', kind: 'plaster', colors: ['#2c3a4f'], scale: 2, roughness: 0.85 },
  { id: 'paint-terracotta', name: 'Terracotta', category: 'paint', kind: 'plaster', colors: ['#b9694b'], scale: 2, roughness: 0.9 },
  { id: 'paint-sky', name: 'Pale Sky', category: 'paint', kind: 'plaster', colors: ['#c9d9e2'], scale: 2, roughness: 0.9 },
  { id: 'paint-blush', name: 'Blush', category: 'paint', kind: 'plaster', colors: ['#e4c9c0'], scale: 2, roughness: 0.9 },
  { id: 'plaster-grey', name: 'Cement Plaster', category: 'paint', kind: 'plaster', colors: ['#aeaca6'], scale: 2, roughness: 0.95, params: { rough: 1 } },
  { id: 'render-white', name: 'Exterior Render White', category: 'paint', kind: 'plaster', colors: ['#eeebe4'], scale: 2, roughness: 0.92, params: { rough: 1 } },
  { id: 'render-ivory', name: 'Exterior Render Ivory', category: 'paint', kind: 'plaster', colors: ['#e6dcc8'], scale: 2, roughness: 0.92, params: { rough: 1 } },
  { id: 'render-graphite', name: 'Exterior Render Graphite', category: 'paint', kind: 'plaster', colors: ['#4a4c4f'], scale: 2, roughness: 0.9, params: { rough: 1 } },
  // Metal
  { id: 'metal-brushed', name: 'Brushed Steel', category: 'metal', kind: 'metal', colors: ['#b9bcbf'], scale: 0.5, roughness: 0.35, metalness: 1, reflection: 0.8, params: { brushed: 1 } },
  { id: 'metal-black', name: 'Black Metal', category: 'metal', kind: 'metal', colors: ['#232426'], scale: 0.5, roughness: 0.4, metalness: 0.8, reflection: 0.5 },
  { id: 'metal-brass', name: 'Brushed Brass', category: 'metal', kind: 'metal', colors: ['#b8924a'], scale: 0.5, roughness: 0.3, metalness: 1, reflection: 0.8, params: { brushed: 1 } },
  { id: 'metal-aluminum', name: 'Anodized Aluminum', category: 'metal', kind: 'metal', colors: ['#8e9296'], scale: 0.5, roughness: 0.4, metalness: 0.9, reflection: 0.6 },
  { id: 'metal-copper', name: 'Copper', category: 'metal', kind: 'metal', colors: ['#b06a45'], scale: 0.5, roughness: 0.3, metalness: 1, reflection: 0.8 },
  { id: 'metal-corten', name: 'Corten Steel', category: 'metal', kind: 'concrete', colors: ['#8a4a2a', '#6d3820'], scale: 1.5, roughness: 0.85, metalness: 0.3, reflection: 0.1 },
  // Glass
  { id: 'glass-clear', name: 'Clear Glass', category: 'glass', kind: 'glass', colors: ['#cfe3e8'], scale: 1, roughness: 0.02, reflection: 1, opacity: 0.22 },
  { id: 'glass-frosted', name: 'Frosted Glass', category: 'glass', kind: 'glass', colors: ['#e8eef0'], scale: 1, roughness: 0.5, reflection: 0.4, opacity: 0.7 },
  { id: 'glass-grey', name: 'Grey Tinted Glass', category: 'glass', kind: 'glass', colors: ['#6e7b80'], scale: 1, roughness: 0.02, reflection: 1, opacity: 0.45 },
  { id: 'glass-bronze', name: 'Bronze Tinted Glass', category: 'glass', kind: 'glass', colors: ['#8a7358'], scale: 1, roughness: 0.02, reflection: 1, opacity: 0.45 },
  // Roof
  { id: 'roof-clay', name: 'Clay Roof Tiles', category: 'roof', kind: 'roof-tiles', colors: ['#a4553a', '#86432d', '#bf6c4c'], scale: 1.0, roughness: 0.75, reflection: 0.05 },
  { id: 'roof-slate', name: 'Slate Shingles', category: 'roof', kind: 'shingles', colors: ['#474d53', '#383d42', '#5a6167'], scale: 1.0, roughness: 0.7, reflection: 0.1 },
  { id: 'roof-standing-seam', name: 'Standing Seam Metal', category: 'roof', kind: 'standing-seam', colors: ['#3c3f42', '#2f3134'], scale: 1.0, roughness: 0.4, metalness: 0.6, reflection: 0.4 },
  { id: 'roof-concrete-tile', name: 'Concrete Roof Tiles', category: 'roof', kind: 'roof-tiles', colors: ['#6b6a66', '#595855', '#7d7c77'], scale: 1.0, roughness: 0.8, reflection: 0.05 },
  { id: 'roof-membrane', name: 'Roof Membrane (flat)', category: 'roof', kind: 'concrete', colors: ['#b7b3aa', '#a19d94'], scale: 3.0, roughness: 0.9, reflection: 0.03 },
  // Wallpaper
  { id: 'wallpaper-damask', name: 'Damask', category: 'wallpaper', kind: 'wallpaper', colors: ['#d8cdb8', '#bfae8e'], scale: 0.6, roughness: 0.8, params: { motif: 1 } },
  { id: 'wallpaper-stripes', name: 'Pinstripe', category: 'wallpaper', kind: 'wallpaper', colors: ['#e3ddd2', '#c9bfae'], scale: 0.5, roughness: 0.8, params: { motif: 2 } },
  { id: 'wallpaper-geometric', name: 'Geometric', category: 'wallpaper', kind: 'wallpaper', colors: ['#2f4a57', '#c9a45b'], scale: 0.5, roughness: 0.8, params: { motif: 3 } },
  { id: 'wallpaper-botanical', name: 'Botanical', category: 'wallpaper', kind: 'wallpaper', colors: ['#dfe6dc', '#6f8d6a'], scale: 0.7, roughness: 0.8, params: { motif: 4 } },
  { id: 'wallpaper-linen', name: 'Linen Texture', category: 'wallpaper', kind: 'fabric', colors: ['#d7cfc1', '#c5bba9'], scale: 0.4, roughness: 0.9 },
  // Ground & outdoor
  { id: 'grass-lawn', name: 'Lawn Grass', category: 'ground', kind: 'grass', colors: ['#5c8a3a', '#4a7430', '#77a24b'], scale: 2.0, roughness: 0.95 },
  { id: 'asphalt', name: 'Asphalt', category: 'ground', kind: 'asphalt', colors: ['#3a3b3d', '#2c2d2f', '#58595c'], scale: 2.0, roughness: 0.9 },
  { id: 'pavers-grey', name: 'Grey Pavers', category: 'ground', kind: 'pavers', colors: ['#8f8e8a', '#7a7975', '#a3a29e'], scale: 1.2, roughness: 0.85, params: { pw: 0.2, ph: 0.1 } },
  { id: 'pavers-red', name: 'Tuff Tiles Red', category: 'ground', kind: 'pavers', colors: ['#9b5a44', '#834a37', '#b06a51'], scale: 1.2, roughness: 0.85, params: { pw: 0.2, ph: 0.1 } },
  { id: 'gravel', name: 'Gravel', category: 'ground', kind: 'gravel', colors: ['#b3ab9d', '#8d8578', '#d2cbbe'], scale: 1.0, roughness: 0.95 },
  { id: 'water-pool', name: 'Pool Water', category: 'ground', kind: 'water', colors: ['#2e9fbf', '#63c7de'], scale: 2.0, roughness: 0.05, reflection: 1, opacity: 0.8 },
  { id: 'soil-mulch', name: 'Mulch', category: 'ground', kind: 'gravel', colors: ['#4a3426', '#3a281c', '#5e4331'], scale: 1.0, roughness: 0.95 },
  { id: 'rubber-black', name: 'Rubber Flooring', category: 'ground', kind: 'concrete', colors: ['#2a2a2b', '#232324'], scale: 1.0, roughness: 0.9 },
  // Fabric
  { id: 'fabric-carpet-charcoal', name: 'Charcoal Carpet', category: 'fabric', kind: 'fabric', colors: ['#3b3c3f', '#303134'], scale: 0.5, roughness: 1 },
  { id: 'fabric-acoustic', name: 'Acoustic Fabric', category: 'fabric', kind: 'fabric', colors: ['#2f2d35', '#26242b'], scale: 0.5, roughness: 1 },
  { id: 'fabric-linen', name: 'Linen Beige', category: 'fabric', kind: 'fabric', colors: ['#cfc4b1', '#bdb19c'], scale: 0.3, roughness: 0.95 },
  { id: 'fabric-velvet-green', name: 'Velvet Green', category: 'fabric', kind: 'fabric', colors: ['#2f4a3c', '#263d31'], scale: 0.3, roughness: 0.85 },
  { id: 'fabric-leather', name: 'Tan Leather', category: 'fabric', kind: 'fabric', colors: ['#8a5a36', '#744a2b'], scale: 0.4, roughness: 0.55, reflection: 0.2 },
  { id: 'fabric-grey', name: 'Grey Upholstery', category: 'fabric', kind: 'fabric', colors: ['#8c8d8f', '#7a7b7d'], scale: 0.3, roughness: 0.95 }
]

export const LIBRARY: MaterialDef[] = R.map((r, i) => ({
  id: `lib:${r.id}`,
  name: r.name,
  category: r.category,
  source: 'library',
  color: '#ffffff',
  procedural: { kind: r.kind, seed: 1000 + i * 17, colors: r.colors, params: r.params },
  scale: r.scale,
  rotation: 0,
  offset: { x: 0, y: 0 },
  roughness: r.roughness,
  metalness: r.metalness ?? 0,
  reflection: r.reflection ?? 0.1,
  brightness: 0,
  contrast: 0,
  normalStrength: r.category === 'paint' || r.category === 'glass' ? 0.2 : 1,
  opacity: r.opacity
}))

const BY_ID = new Map(LIBRARY.map((m) => [m.id, m]))

export function libraryMaterial(id: string): MaterialDef | undefined {
  return BY_ID.get(id)
}

/** Categories shown in the library panel (§16 list order). */
export const LIBRARY_CATEGORIES: { key: MaterialCategory; label: string }[] = [
  { key: 'marble', label: 'Marble' },
  { key: 'granite', label: 'Granite' },
  { key: 'ceramic', label: 'Ceramic' },
  { key: 'porcelain', label: 'Porcelain' },
  { key: 'wood', label: 'Wood' },
  { key: 'concrete', label: 'Concrete' },
  { key: 'brick', label: 'Brick' },
  { key: 'stone', label: 'Stone' },
  { key: 'paint', label: 'Paint' },
  { key: 'metal', label: 'Metal' },
  { key: 'glass', label: 'Glass' },
  { key: 'roof', label: 'Roof' },
  { key: 'wallpaper', label: 'Wallpaper' },
  { key: 'ground', label: 'Outdoor' },
  { key: 'fabric', label: 'Fabric' }
]

/** Resolve a material id against the project's custom materials, then the library. */
export function resolveMaterial(id: string | undefined, custom: MaterialDef[]): MaterialDef | undefined {
  if (!id) return undefined
  return custom.find((m) => m.id === id) ?? BY_ID.get(id)
}

/** Representative flat color (used for 2D material layer, thumbnails fallback, elevations). */
export function materialSwatch(m: MaterialDef | undefined): string {
  if (!m) return '#cccccc'
  if (m.analysis?.averageColor) return m.analysis.averageColor
  return m.procedural?.colors[0] ?? m.color
}
