"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Widget, WidgetAction } from "@/types/a2a";
import { cn } from "@/lib/utils";

// Widget Registry - maps widget types to React components
const widgetRegistry: Record<string, React.ComponentType<WidgetProps>> = {
  button: ButtonWidget,
  form: FormWidget,
  card: CardWidget,
  list: ListWidget,
  table: TableWidget,
  progress: ProgressWidget,
  select: SelectWidget,
  input: InputWidget,
};

interface WidgetProps {
  widget: Widget;
  onAction?: (action: WidgetAction) => void;
}

// Widget Renderer - renders a widget based on its type
export function WidgetRenderer({ widget, onAction }: WidgetProps) {
  const WidgetComponent = widgetRegistry[widget.type];

  if (!WidgetComponent) {
    return (
      <div className="p-2 bg-destructive/10 text-destructive rounded-md text-sm">
        Unknown widget type: {widget.type}
      </div>
    );
  }

  return <WidgetComponent widget={widget} onAction={onAction} />;
}

// Widget Catalog - renders multiple widgets
interface WidgetCatalogProps {
  widgets: Widget[];
  onAction?: (action: WidgetAction) => void;
}

export function WidgetCatalog({ widgets, onAction }: WidgetCatalogProps) {
  return (
    <div className="space-y-3">
      {widgets.map((widget) => (
        <motion.div
          key={widget.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <WidgetRenderer widget={widget} onAction={onAction} />
        </motion.div>
      ))}
    </div>
  );
}

// Button Widget
function ButtonWidget({ widget, onAction }: WidgetProps) {
  const { label, variant = "default", loading, disabled } = widget.props as {
    label?: string;
    variant?: "default" | "outline" | "secondary" | "ghost";
    loading?: boolean;
    disabled?: boolean;
  };

  const handleClick = () => {
    if (widget.actions?.[0]) {
      onAction?.(widget.actions[0]);
    }
  };

  return (
    <Button
      variant={variant}
      disabled={disabled || loading}
      onClick={handleClick}
    >
      {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
      {label || "Button"}
    </Button>
  );
}

// Form Widget
function FormWidget({ widget, onAction }: WidgetProps) {
  const { title, fields = [], submitLabel = "Submit" } = widget.props as {
    title?: string;
    fields?: Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
      placeholder?: string;
    }>;
    submitLabel?: string;
  };

  const [formData, setFormData] = React.useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (widget.actions?.[0]) {
      onAction?.({
        ...widget.actions[0],
        context: { ...widget.actions[0].context, formData },
      });
    }
  };

  return (
    <Card>
      {title && (
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="text-sm font-medium mb-1 block">
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </label>
              <Input
                type={field.type || "text"}
                placeholder={field.placeholder}
                required={field.required}
                value={formData[field.name] || ""}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
              />
            </div>
          ))}
          <Button type="submit" className="w-full">
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Card Widget
function CardWidget({ widget }: WidgetProps) {
  const { title, description, content, footer, variant = "default" } = widget.props as {
    title?: string;
    description?: string;
    content?: string;
    footer?: string;
    variant?: "default" | "success" | "warning" | "error";
  };

  const variantStyles = {
    default: "",
    success: "border-green-500/50 bg-green-500/5",
    warning: "border-yellow-500/50 bg-yellow-500/5",
    error: "border-red-500/50 bg-red-500/5",
  };

  return (
    <Card className={cn(variantStyles[variant])}>
      {(title || description) && (
        <CardHeader className="pb-3">
          {title && <CardTitle className="text-lg">{title}</CardTitle>}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </CardHeader>
      )}
      {content && (
        <CardContent>
          <p className="text-sm">{content}</p>
        </CardContent>
      )}
      {footer && (
        <div className="px-6 pb-4 text-xs text-muted-foreground">{footer}</div>
      )}
      {widget.children && (
        <CardContent>
          <WidgetCatalog widgets={widget.children} />
        </CardContent>
      )}
    </Card>
  );
}

// List Widget
function ListWidget({ widget, onAction }: WidgetProps) {
  const { title, items = [], ordered = false } = widget.props as {
    title?: string;
    items?: Array<{
      id: string;
      text: string;
      status?: "pending" | "completed" | "failed";
      action?: WidgetAction;
    }>;
    ordered?: boolean;
  };

  const Tag = ordered ? "ol" : "ul";

  return (
    <div>
      {title && <h4 className="font-medium mb-2">{title}</h4>}
      <Tag className={cn("space-y-1", ordered && "list-decimal pl-4")}>
        {items.map((item, index) => (
          <li
            key={item.id || index}
            className={cn(
              "flex items-center gap-2 p-2 rounded-md",
              item.status === "completed" && "bg-green-500/10",
              item.status === "failed" && "bg-red-500/10",
              item.action && "cursor-pointer hover:bg-muted"
            )}
            onClick={() => item.action && onAction?.(item.action)}
          >
            {item.status === "completed" && (
              <Check className="h-4 w-4 text-green-500 shrink-0" />
            )}
            {item.status === "pending" && (
              <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
            )}
            <span className="text-sm">{item.text}</span>
          </li>
        ))}
      </Tag>
    </div>
  );
}

// Table Widget
function TableWidget({ widget }: WidgetProps) {
  const { headers = [], rows = [], title } = widget.props as {
    title?: string;
    headers?: string[];
    rows?: string[][];
  };

  return (
    <div>
      {title && <h4 className="font-medium mb-2">{title}</h4>}
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              {headers.map((header, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Progress Widget
function ProgressWidget({ widget }: WidgetProps) {
  const { value = 0, max = 100, label, showPercentage = true } = widget.props as {
    value?: number;
    max?: number;
    label?: string;
    showPercentage?: boolean;
  };

  const percentage = Math.round((value / max) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        {label && <span className="text-sm">{label}</span>}
        {showPercentage && (
          <span className="text-sm text-muted-foreground">{percentage}%</span>
        )}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

// Select Widget
function SelectWidget({ widget, onAction }: WidgetProps) {
  const { label, options = [], placeholder = "Select..." } = widget.props as {
    label?: string;
    options?: Array<{ value: string; label: string }>;
    placeholder?: string;
  };

  const [isOpen, setIsOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);

  const handleSelect = (value: string) => {
    setSelected(value);
    setIsOpen(false);
    if (widget.actions?.[0]) {
      onAction?.({
        ...widget.actions[0],
        context: { ...widget.actions[0].context, selectedValue: value },
      });
    }
  };

  const selectedOption = options.find((o) => o.value === selected);

  return (
    <div>
      {label && <label className="text-sm font-medium mb-1 block">{label}</label>}
      <div className="relative">
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between px-3 py-2 border rounded-md text-sm",
            "bg-background hover:bg-muted transition-colors"
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className={cn(!selectedOption && "text-muted-foreground")}>
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown className="h-4 w-4" />
        </button>
        {isOpen && (
          <div className="absolute z-10 w-full mt-1 bg-card border rounded-md shadow-lg">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors",
                  selected === option.value && "bg-muted"
                )}
                onClick={() => handleSelect(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Input Widget
function InputWidget({ widget, onAction }: WidgetProps) {
  const { label, placeholder, type = "text", required } = widget.props as {
    label?: string;
    placeholder?: string;
    type?: string;
    required?: boolean;
  };

  const [value, setValue] = React.useState("");

  const handleBlur = () => {
    if (widget.actions?.[0] && value) {
      onAction?.({
        ...widget.actions[0],
        context: { ...widget.actions[0].context, value },
      });
    }
  };

  return (
    <div>
      {label && (
        <label className="text-sm font-medium mb-1 block">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </label>
      )}
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
      />
    </div>
  );
}

export {
  ButtonWidget,
  FormWidget,
  CardWidget,
  ListWidget,
  TableWidget,
  ProgressWidget,
  SelectWidget,
  InputWidget,
};
