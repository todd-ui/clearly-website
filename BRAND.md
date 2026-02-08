# Clearly Brand Guide

## Brand Colors

### Primary (Teal)
| Name | Hex | Usage |
|------|-----|-------|
| **Primary** | `#0D8268` | Buttons, links, accents, section labels |
| **Primary Dark** | `#0A6B56` | Hover states, emphasis |
| **Primary Light** | `#14B89A` | Highlights, gradients |
| **Primary Soft** | `#E6F5F1` | Icon backgrounds, badges, soft accents |
| **Primary Border** | `#A8DFD0` | Borders on primary elements |

### Neutrals
| Name | Hex | Usage |
|------|-----|-------|
| **Background** | `#FAFAF9` | Page backgrounds, alternate sections |
| **Surface** | `#FFFFFF` | Cards, modals, white sections |
| **Text** | `#1A1917` | Headings, primary body text |
| **Text Secondary** | `#5C5856` | Body text, descriptions |
| **Text Muted** | `#8C8780` | Captions, metadata, placeholders |
| **Border** | `#E8E7E4` | Dividers, card borders |

### Gradient
```css
--gradient: linear-gradient(135deg, #0D8268 0%, #14a085 100%);
```

---

## Typography

### Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```
System font stack for optimal performance and native feel.

### Type Scale

| Element | Size (Desktop) | Size (Mobile) | Weight | Line Height |
|---------|---------------|---------------|--------|-------------|
| **H1 (Hero)** | 56px | 40px | 700 | 1.1 |
| **H1 (Page)** | 48px | 36px | 600 | 1.1 |
| **H2 (Section)** | 36-40px | 32px | 700 | 1.2 |
| **H3 (Card)** | 20px | 18px | 600 | 1.3 |
| **Body** | 17px | 16px | 400 | 1.6 |
| **Body Small** | 15px | 14px | 400 | 1.6 |
| **Caption** | 13-14px | 13px | 400-500 | 1.4 |
| **Section Label** | 13px | 13px | 600 | 1.2 |

### Section Labels
```css
.section-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #0D8268;
}
```

---

## Spacing

| Name | Value | Usage |
|------|-------|-------|
| **Section Padding** | 100px (desktop) / 80px (mobile) | Vertical spacing between sections |
| **Container Max** | 1000px | Content max-width |
| **Card Padding** | 32px 24px | Internal card spacing |
| **Gap (Cards)** | 16px | Grid gap between cards |
| **Gap (Footer)** | 48px | Footer column spacing |

---

## Border Radius

| Element | Radius |
|---------|--------|
| **Buttons** | 980px (pill) |
| **Cards** | 16px |
| **Small Cards** | 12px |
| **Icons** | 12px |
| **Badges** | 20px |
| **Inputs** | 12px |

---

## Shadows

```css
/* Subtle card shadow */
box-shadow: 0 2px 8px rgba(0,0,0,0.04);

/* Modal/overlay shadow */
box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
```

---

## CSS Variables Reference

```css
:root {
  /* Primary colors */
  --primary: #0D8268;
  --primary-dark: #0a6b56;
  --primary-light: #14b89a;
  --primary-soft: #E6F5F1;
  --primary-border: #A8DFD0;

  /* Backgrounds */
  --bg: #FAFAF9;
  --surface: #FFFFFF;

  /* Text colors */
  --text: #1A1917;
  --text-secondary: #5C5856;
  --text-muted: #8C8780;

  /* Borders */
  --border: #E8E7E4;

  /* Gradient */
  --gradient: linear-gradient(135deg, #0D8268 0%, #14a085 100%);
}
```

---

## Logo

- **Icon**: Supabase storage at `Clearly Logos/icon.png`
- **Favicon**: Supabase storage at `Clearly Logos/favicon.png`
- **Brand Name**: "Clearly" in system font, weight 600-700

---

## Voice & Tone

- **Clear and direct** — No jargon, no fluff
- **Empathetic but not soft** — Acknowledge difficulty without coddling
- **Confident** — We know this works
- **Focused on resolution** — Always point toward common ground

### Key Phrases
- "Messaging isn't communicating."
- "Interest-based communication"
- "See where you already agree"
- "Built around resolution, not conflict"
- "Shift the patterns"
