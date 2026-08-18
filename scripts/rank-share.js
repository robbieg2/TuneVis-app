// rank-share.js — shared export helpers for ranking pages (text + image card)

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
        t = t.slice(0, -1);
    }
    return `${t}…`;
}

// Plain-text version — always works, no image loading involved.
export function buildRankingText({ title, subtitle, items }) {
    const lines = [title || "My Ranking"];
    if (subtitle) lines.push(subtitle);
    lines.push("");
    items.forEach((item, i) => {
        lines.push(`${i + 1}. ${item.name}${item.subtitle ? ` — ${item.subtitle}` : ""}`);
    });
    lines.push("");
    lines.push("Made with TuneVis");
    return lines.join("\n");
}

// Renders a shareable image card onto a canvas. Cover art is loaded with
// crossOrigin="anonymous" — if an image's host doesn't send CORS headers
// the load simply fails and a placeholder swatch is drawn instead, so the
// canvas is never left in a tainted state that would block export.
export async function buildRankingImage({ title, subtitle, items }) {
    const width = 640;
    const rowHeight = 68;
    const headerHeight = subtitle ? 108 : 82;
    const footerHeight = 42;
    const padding = 28;
    const height = headerHeight + items.length * rowHeight + footerHeight;

    const canvas = document.createElement("canvas");
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(padding, 0, width - padding, 0);
    gradient.addColorStop(0, "#ff7aff");
    gradient.addColorStop(0.55, "#d65cff");
    gradient.addColorStop(1, "#1db954");
    ctx.fillStyle = gradient;
    ctx.font = "700 26px Poppins, sans-serif";
    ctx.fillText(truncateText(ctx, title || "My Ranking", width - padding * 2), padding, 44);

    if (subtitle) {
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.font = "400 14px Poppins, sans-serif";
        ctx.fillText(truncateText(ctx, subtitle, width - padding * 2), padding, 68);
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowY = headerHeight + i * rowHeight;

        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "600 16px Poppins, sans-serif";
        ctx.fillText(String(i + 1), padding, rowY + rowHeight / 2 + 6);

        const imgSize = 48;
        const imgX = padding + 32;
        const imgY = rowY + (rowHeight - imgSize) / 2;

        let drew = false;
        if (item.image) {
            try {
                const img = await loadImage(item.image);
                ctx.save();
                roundRectPath(ctx, imgX, imgY, imgSize, imgSize, 6);
                ctx.clip();
                ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
                ctx.restore();
                drew = true;
            } catch {}
        }
        if (!drew) {
            ctx.fillStyle = "rgba(255,255,255,0.08)";
            roundRectPath(ctx, imgX, imgY, imgSize, imgSize, 6);
            ctx.fill();
        }

        const textX = imgX + imgSize + 16;
        const maxTextWidth = width - textX - padding;

        ctx.fillStyle = "#ffffff";
        ctx.font = "600 15px Poppins, sans-serif";
        ctx.fillText(truncateText(ctx, item.name, maxTextWidth), textX, rowY + rowHeight / 2 - 3);

        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "400 12px Poppins, sans-serif";
        ctx.fillText(truncateText(ctx, item.subtitle || "", maxTextWidth), textX, rowY + rowHeight / 2 + 15);

        if (i < items.length - 1) {
            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(padding, rowY + rowHeight);
            ctx.lineTo(width - padding, rowY + rowHeight);
            ctx.stroke();
        }
    }

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "400 12px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Made with TuneVis", width / 2, height - 16);
    ctx.textAlign = "left";

    return canvas;
}

export function downloadCanvas(canvas, filename) {
    canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
}

export async function copyText(text) {
    await navigator.clipboard.writeText(text);
}
