export type TemplateId = "vip" | "warm" | "clean" | "editorial";
export type ProductCategory = "quilt" | "bedding-set";
export type ModuleSection =
  | "hero"
  | "benefits"
  | "texture"
  | "filling"
  | "pattern"
  | "components"
  | "craft"
  | "scene"
  | "colors"
  | "specs"
  | "care";
export type AssetRole = "整体" | "细节" | "颜色" | "其他" | "叠放" | "填充" | "工艺" | "被套" | "床单" | "枕套";
export type Asset = {
  id: string;
  url: string;
  name: string;
  width: number;
  height: number;
  role: AssetRole;
  generated?: boolean;
};
export type ProductInfo = {
  brand: string;
  name: string;
  subtitle: string;
  material: string;
  filling: string;
  size: string;
  weight: string;
  colors: string;
  care: string;
  sellingPoints: string;
  setContents?: string;
};
export type DesignModule = {
  id: string;
  kind: "main" | "detail";
  index: number;
  title: string;
  subtitle: string;
  imageId: string;
  imageId2: string;
  cropX: number;
  cropY: number;
  layout: number;
  section?: ModuleSection;
  sourceImageId?: string;
  sourceImageId2?: string;
  aiStatus?: "pending" | "succeeded" | "failed";
  aiError?: string;
};
export type Project = {
  id: string;
  info: ProductInfo;
  template: TemplateId;
  category?: ProductCategory;
  assets: Asset[];
  modules: DesignModule[];
  updatedAt: string;
  status: "draft" | "ready";
  sample?: boolean;
  output?: "main" | "detail";
  generation?: "template" | "ai";
  generationBatch?: string;
  workflow?: "plan" | "preview" | "complete";
};
export type CategoryProfile = {
  id: ProductCategory;
  name: string;
  referenceUrl: string;
  summary: string;
  photoGuide: string;
  palette: { paper: string; ink: string; muted: string; accent: string; brand: string };
};
export const categories: CategoryProfile[] = [
  {
    id: "quilt",
    name: "被子",
    referenceUrl: "https://detail.vip.com/detail-1714230467-6922096046911460931.html",
    summary: "叠被大图突出真实蓬松感，米白底配黑色短标题与驼橙色卖点；从整体、面料到填充与工艺逐层说明。",
    photoGuide: "建议准备叠放、整体铺床、面料特写、填充实拍、绗缝或包边工艺及颜色图。没有填充实拍时保留实物展示，不合成填充剖面。",
    palette: { paper: "#f7f1e7", ink: "#292521", muted: "#7b6d5d", accent: "#b77640", brand: "#743b39" },
  },
  {
    id: "bedding-set",
    name: "床上套件",
    referenceUrl: "https://detail.vip.com/detail-1714230467-6921823509075762179.html",
    summary: "完整铺床场景展示花型与搭配，暖日光和奶油色衬底，标题置于画面上方；依次看花型、面料、套件组成与工艺。",
    photoGuide: "建议准备完整铺床、被套正反面或花型近景、面料、被套、床单、枕套及工艺图；仅展示当前商品实际包含的件数与配件。",
    palette: { paper: "#fff8e8", ink: "#373027", muted: "#827354", accent: "#b59a56", brand: "#743b39" },
  },
];
export function categoryFor(p: Pick<Project, "category">): CategoryProfile {
  return categories.find((category) => category.id === p.category) || categories[0];
}
export const templates: {
  id: TemplateId;
  name: string;
  tag: string;
  description: string;
  bg: string;
  ink: string;
  accent: string;
  image: string;
}[] = [
  {
    id: "vip",
    name: "宜爱家店铺",
    tag: "商品大图 · 清晰卖点",
    description: "米白与暖木色场景，短标题分层讲清卖点",
    bg: "#f6f0e5",
    ink: "#302923",
    accent: "#763e40",
    image: "/samples/00224.jpg",
  },
  {
    id: "warm",
    name: "温暖家居",
    tag: "生活感 · 柔和留白",
    description: "适合素色被子、床品与柔软织物",
    bg: "#f5f0e8",
    ink: "#443b34",
    accent: "#a7805e",
    image: "/samples/00224.jpg",
  },
  {
    id: "clean",
    name: "简洁实拍",
    tag: "清晰 · 大图展示",
    description: "突出商品实拍，信息轻盈有序",
    bg: "#ffffff",
    ink: "#202626",
    accent: "#64736c",
    image: "/samples/00237.jpg",
  },
  {
    id: "editorial",
    name: "质感画册",
    tag: "层次 · 细节叙事",
    description: "用深浅对比呈现纹理与工艺",
    bg: "#e9e4dc",
    ink: "#262926",
    accent: "#747761",
    image: "/samples/00233.jpg",
  },
];
export const emptyInfo: ProductInfo = {
  brand: "宜爱家",
  name: "",
  subtitle: "",
  material: "",
  filling: "",
  size: "",
  weight: "",
  colors: "",
  care: "",
  sellingPoints: "",
  setContents: "",
};
export function freshProject(): Project {
  return {
    id: crypto.randomUUID(),
    info: { ...emptyInfo },
    template: "vip",
    category: "quilt",
    assets: [],
    modules: [],
    updatedAt: new Date().toISOString(),
    status: "draft",
    workflow: "plan",
  };
}
export function makeModules(p: Project): DesignModule[] {
  const originals = p.assets.filter((a) => !a.generated);
  const whole = originals.filter((a) => a.role === "整体");
  const detail = originals.filter((a) => a.role === "细节");
  const colors = originals.filter((a) => a.role === "颜色");
  const choose = (arr: Asset[], i: number) =>
    (arr[i % (arr.length || 1)] || originals[i % originals.length])?.id || "";
  const points = p.info.sellingPoints
    .split(/[\n；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (p.template === "vip") {
    const short = (value: string, fallback: string, max = 24) =>
      (value.trim() || fallback).slice(0, max);
    const withRole = (role: AssetRole) => originals.filter((a) => a.role === role);
    const prefer = (...groups: Asset[][]) => groups.find((group) => group.length) || originals;
    const folded = withRole("叠放");
    const filling = withRole("填充");
    const craft = withRole("工艺");
    const duvet = withRole("被套");
    const sheet = withRole("床单");
    const pillow = withRole("枕套");
    const craftId = craft.length ? choose(craft, 0) : choose(detail, Math.min(2, Math.max(0, detail.length - 1)));
    const colorPhoto = prefer(colors, whole);
    const texturePhoto = prefer(detail, duvet, whole);
    const compositionPhoto = prefer(duvet, sheet, pillow, whole);
    const componentSecond = [...pillow, ...sheet, ...duvet].find((a) => a.id !== choose(compositionPhoto, 0));
    type Descriptor = {
      section: ModuleSection;
      title: string;
      subtitle: string;
      imageId: string;
      imageId2?: string;
    };
    const texture: Descriptor = {
      section: "texture", title: short(points[0] || "", "近看面料纹理"),
      subtitle: p.info.material ? "面料：" + p.info.material : "面料纹理，用近景实拍看清", imageId: choose(texturePhoto, 0),
    };
    const craftsmanship: Descriptor = {
      section: "craft", title: short(points[1] || "", "做工藏在细节里"),
      subtitle: "工艺细节单独展示，请以当前商品实拍为准", imageId: craftId,
    };
    const color: Descriptor = {
      section: "colors", title: "颜色实拍对照", subtitle: p.info.colors || "请核对所选颜色",
      imageId: choose(colorPhoto, 0), imageId2: choose(colorPhoto, 1),
    };
    const specs: Descriptor = {
      section: "specs", title: "商品参数与洗护",
      subtitle: p.info.care ? "购买前核对规格，使用前查看洗护说明" : "购买前请核对规格；洗护方式以商品水洗标为准",
      imageId: choose(whole, 0),
    };
    const hero: Descriptor = {
      section: "hero", title: short(p.info.name, "商品整体展示"),
      subtitle: short(p.info.subtitle, points[0] || "", 80),
      imageId: choose(categoryFor(p).id === "quilt" ? prefer(folded, whole) : whole, 0),
    };
    const scene: Descriptor = {
      section: "scene", title: categoryFor(p).id === "quilt" ? "铺开看看，整体效果" : "一眼看全，整床搭配",
      subtitle: "铺床实拍，查看整体花型与配色", imageId: choose(whole, 1),
    };
    const fill: Descriptor = {
      section: "filling", title: p.info.filling ? "填充与被子形态" : "看清被子形态",
      subtitle: p.info.filling ? "填充物：" + p.info.filling : filling.length ? "填充实拍，展示实际商品内部" : "当前展示商品外观；填充信息请以商品标签为准",
      imageId: choose(prefer(filling, folded, whole), 0),
    };
    const components: Descriptor = {
      section: "components", title: "套件组成，逐件看清",
      subtitle: p.info.setContents?.trim() || "请核对当前套件实际包含的品项与件数",
      imageId: choose(compositionPhoto, 0), imageId2: componentSecond?.id || "",
    };
    const pattern: Descriptor = {
      section: "pattern", title: "花型与配色，近看更清楚",
      subtitle: "花型大小、排列与配色，以商品实拍为准", imageId: choose(prefer(colors, duvet, whole), 0),
    };
    const descriptors: Descriptor[] = categoryFor(p).id === "bedding-set" ? [
      hero, scene, texture, components, color,
      hero, pattern, texture, components, craftsmanship, color, specs,
    ] : [
      hero, scene, fill, craftsmanship, color,
      hero,
      { section: "benefits", title: "值得细看的地方", subtitle: points.slice(0, 6).join(" · ") || "整体形态 · 面料纹理 · 做工细节", imageId: choose(whole, 0) },
      texture, fill, craftsmanship, color, specs,
    ];
    return descriptors.map((item, i): DesignModule => ({
      id: (i < 5 ? "main-" : "detail-") + (i < 5 ? i + 1 : i - 4),
      kind: i < 5 ? "main" : "detail",
      index: i < 5 ? i + 1 : i - 4,
      section: item.section,
      title: item.title,
      subtitle: item.subtitle.slice(0, 160),
      imageId: item.imageId,
      imageId2: item.imageId2 || "",
      sourceImageId: item.imageId,
      sourceImageId2: item.imageId2 || "",
      cropX: 50,
      cropY: 50,
      layout: i,
    })).filter((m) => !p.output || m.kind === p.output);
  }
  const headings = [
    p.info.name,
    points[0] || "细看，更多质感",
    points[1] || "把细节放大",
    "另一面，同样好看",
    p.info.colors || "选择喜欢的颜色",
    p.info.name,
    points[0] || "看得见的细节",
    points[1] || "细节，值得慢慢看",
    "换个角度，看看它",
    p.info.colors || "你的卧室，你的颜色",
    "商品信息",
    "把喜欢，带回家",
  ];
  return headings
    .map((title, i) => ({
      id: (i < 5 ? "main-" : "detail-") + (i < 5 ? i + 1 : i - 4),
      kind: i < 5 ? "main" : "detail",
      index: i < 5 ? i + 1 : i - 4,
      title,
      subtitle:
        i === 0 || i === 5
          ? p.info.subtitle
          : i === 10
            ? "购买前请核对商品信息"
            : i === 11
              ? "请核对所选颜色与规格"
              : points[i % Math.max(points.length, 1)] || "",
      imageId:
        i === 1 || i === 2 || i === 6 || i === 7
          ? choose(detail, i)
          : i === 3 || i === 4 || i === 9
            ? choose(colors, i)
            : choose(whole, i),
      imageId2: choose(colors.length ? colors : detail, i + 1),
      cropX: 50,
      cropY: 50,
      layout: i,
    }))
    .filter((m) => !p.output || m.kind === p.output)
    .map((m) => ({ ...m, sourceImageId: m.imageId, sourceImageId2: m.imageId2 })) as DesignModule[];
}
export function sampleProject(): Project {
  const info: ProductInfo = {
    brand: "宜爱家",
    name: "立体格纹绗缝被",
    subtitle: "格纹肌理 · 弧线绗缝",
    material: "",
    filling: "",
    size: "",
    weight: "",
    colors: "米白 · 灰紫",
    care: "",
    sellingPoints: "格纹肌理\n弧线绗缝\n两色展示",
  };
  const assets: Asset[] = [
    ["00224", "米白 · 整体", "整体"],
    ["00237", "灰紫 · 整体", "整体"],
    ["00233", "米白 · 格纹特写", "细节"],
    ["00246", "灰紫 · 格纹特写", "细节"],
    ["00229", "米白 · 绗缝细节", "细节"],
    ["00265-edge", "被面 · 边缘细节", "细节"],
    ["00225", "米白 · 配色", "颜色"],
    ["00240", "灰紫 · 配色", "颜色"],
  ].map(([id, name, role]) => ({
    id,
    url: "/samples/" + id + ".jpg",
    name,
    width: 1800,
    height: 1800,
    role: role as AssetRole,
  }));
  const p: Project = {
    id: "sample-quilt",
    info,
    template: "vip",
    category: "quilt",
    assets,
    modules: [],
    updatedAt: "2026-10-04T07:00:00.000Z",
    status: "ready",
    sample: true,
    workflow: "plan",
  };
  p.modules = makeModules(p);
  return p;
}
export function moduleSection(m: DesignModule): ModuleSection {
  if (m.section) return m.section;
  const legacy: ModuleSection[] = m.kind === "main"
    ? ["hero", "texture", "craft", "scene", "colors"]
    : ["hero", "texture", "craft", "scene", "colors", "specs", "care"];
  return legacy[m.index - 1] || "hero";
}
export function modulePurpose(m: DesignModule): string {
  const labels: Record<ModuleSection, string> = {
    hero: "首图 · 先看商品与核心卖点",
    benefits: "卖点总览 · 先说清值得看的地方",
    texture: "面料纹理 · 用近景实拍提供依据",
    filling: "填充形态 · 用实拍与标签说明内部和外观",
    pattern: "花型配色 · 看清图案与配色搭配",
    components: "套件组成 · 核对实际品项与件数",
    craft: "做工细节 · 用实拍查看细部工艺",
    scene: "整体场景 · 查看铺床效果",
    colors: "颜色对照 · 帮助选择配色",
    specs: "商品参数 · 核对材质与规格",
    care: "选购洗护 · 说明使用与维护",
  };
  return labels[moduleSection(m)];
}
export function needsAI(p: Project, m: DesignModule): boolean {
  const section = moduleSection(m);
  return p.template === "vip"
    ? section === "hero" || section === "scene"
    : section !== "specs";
}
export function prepareImageRun(p: Project, onlyId?: string): Project {
  return {
    ...p, generation: "ai",
    modules: p.modules.map((m) => ({ ...m,
      // A one-image redo of a completed photo layout leaves every other image ready.
      aiStatus: !needsAI(p, m) || (onlyId && p.workflow !== "preview" && p.generation !== "ai" && m.id !== onlyId)
        ? "succeeded" : m.aiStatus || "pending",
    })),
  };
}
export function sourceAsset(p: Project, m: DesignModule): Asset | undefined {
  // Once chosen, a missing source must be repaired explicitly instead of switching products/colors.
  const id = m.sourceImageId || m.imageId;
  return p.assets.find((a) => a.id === id && !a.generated);
}
export function usesSecondary(m: DesignModule): boolean {
  return m.section ? m.section === "colors" || m.section === "components" : [2, 4, 8, 9].includes(m.layout);
}
export function switchCategory(p: Project, category: ProductCategory): Project {
  const next: Project = {
    ...p, category, template: "vip", assets: p.assets.filter((asset) => !asset.generated),
    modules: [], generation: "template", generationBatch: undefined,
    workflow: "plan", status: "draft",
  };
  if (next.assets.length) next.modules = makeModules(next);
  return next;
}
export function dimensions(m: DesignModule) {
  const sectionHeights: Record<ModuleSection, number> = {
    hero: 1180, benefits: 1120, texture: 1160, craft: 1160,
    scene: 1160, colors: 1900, specs: 1380, care: 1000,
    filling: 1300, pattern: 1160, components: 1580,
  };
  return m.kind === "main"
    ? { width: 1200, height: 1200 }
    : {
        width: 790,
        height: m.section ? sectionHeights[m.section] : [1180, 1120, 1160, 1160, 1180, 980, 1200][m.index - 1] || 1180,
      };
}
