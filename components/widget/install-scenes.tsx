import { MessageCircle, MousePointer2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { Scene } from "@/lib/widget/install";

function Window({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ig-win" aria-hidden>
      <div className="ig-bar">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      <div className="ig-body">{children}</div>
    </div>
  );
}

/** One animated frame of the walkthrough. Decorative: the step's title and text are real text next to it. */
export function SceneView({ scene, accent }: { scene: Scene; accent: string }) {
  if (scene.type === "editor") {
    return (
      <Window title={scene.file}>
        <div className="ig-code">
          {scene.lines.map((line, i) => (
            <div key={i} className={`ig-line ${line.mark ?? ""}`}>
              <span className="ig-no">{i + 1}</span>
              <span className="ig-txt">{line.text || " "}</span>
            </div>
          ))}
        </div>
      </Window>
    );
  }
  if (scene.type === "menu") {
    return (
      <Window title={scene.app}>
        <div className="ig-menu">
          {scene.items.map((item, i) => (
            <div key={item} className="ig-row" style={{ "--i": i } as CSSProperties}>
              <b>{item}</b>
              <MousePointer2 className="ig-cur" style={{ "--i": i } as CSSProperties} fill="currentColor" />
            </div>
          ))}
        </div>
      </Window>
    );
  }
  if (scene.type === "paste") {
    return (
      <Window title={scene.app}>
        <div className="ig-paste">
          <div className="ig-label">{scene.label}</div>
          <div className="ig-box">
            <span>{'<script src="…/widget.js"'}</span>
            <span>{'  data-key="…" async></script>'}</span>
            <em />
          </div>
          <div className="ig-btn">{scene.action}</div>
        </div>
      </Window>
    );
  }
  return (
    <Window title="your-website.com">
      <div className="ig-site">
        <div className="ig-sk" style={{ height: 10, width: "38%" }} />
        <div className="ig-sk" style={{ height: 22, width: "70%", marginTop: 8 }} />
        <div className="ig-sk" style={{ height: 10, width: "55%" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <div className="ig-sk" style={{ height: 52, flex: 1 }} />
          <div className="ig-sk" style={{ height: 52, flex: 1 }} />
          <div className="ig-sk" style={{ height: 52, flex: 1 }} />
        </div>
        <div className="ig-tip">Hi! Ask me anything.</div>
        <div className="ig-bubble" style={{ background: accent }}>
          <MessageCircle className="size-6" aria-hidden />
        </div>
      </div>
    </Window>
  );
}
