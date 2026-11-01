export interface CityQuestProgress { active: string | null; step: number; completed: string[]; visited?: string[] }
export interface CityState {
  discovered: readonly string[];
  completed: readonly string[];
  quests: readonly { id: string; title: string; giver: string; wave: number }[];
  active: {
    id: string; title: string; step: number; total: number; targetId: string;
    target: { x: number; z: number } | null;
    targets?: readonly string[];
    clue: string | null; instruction: string; canAct: boolean;
    options: readonly { id: string; label: string }[];
  } | null;
}
