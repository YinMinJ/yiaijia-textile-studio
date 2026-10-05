"use client";

import { Check, ExternalLink, Layers, BedDouble } from "lucide-react";
import { categories, type ProductCategory } from "@/lib/design-model";

export default function CategoryPicker({ value, onChange, compact = false, disabled = false }: {
  value: ProductCategory;
  onChange: (value: ProductCategory) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return <div className={"category-picker " + (compact ? "compact" : "")}>
    <div className="category-options" role="group" aria-label="商品类目">
      {categories.map((category) => <div className={"category-card " + (category.id === value ? "active" : "")} key={category.id}>
        <button type="button" aria-pressed={category.id === value} disabled={disabled} onClick={() => onChange(category.id)}>
          <span className="category-icon">{category.id === "quilt" ? <Layers size={22} /> : <BedDouble size={22} />}</span>
          <span><b>{category.name}</b><small>{compact ? category.id === "quilt" ? "叠放 · 填充 · 工艺" : "整床 · 花型 · 组成" : category.id === "quilt" ? "叠放体积 · 面料填充 · 工艺" : "整床搭配 · 花型面料 · 套件组成"}</small></span>
          {category.id === value && <Check size={17} className="category-check" />}
        </button>
        <a href={category.referenceUrl} target="_blank" rel="noreferrer">查看指定参考商品 <ExternalLink size={12} /></a>
      </div>)}
    </div>
    {!compact && <p className="category-note">切换类目会按对应参考重排标题、选图和顺序，保留商品资料与原始实拍。</p>}
  </div>;
}
