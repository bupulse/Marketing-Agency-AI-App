import { Bot, CircleHelp, Clock, GitBranch, Hand, MessageSquare, OctagonX, Sparkles, Zap } from "lucide-react";
import type { NodeType } from "@/lib/automations/graph";

/** The icon of each kind of step, on the canvas boxes (canvas.tsx) and the editor's add buttons (editor.tsx). */
export const ICONS: Record<NodeType, typeof Zap> = { trigger: Zap, message: MessageSquare, question: CircleHelp, ai: Sparkles, condition: GitBranch, action: Bot, wait: Clock, handover: Hand, end: OctagonX };
