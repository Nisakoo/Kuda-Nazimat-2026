import { describe, it, expect } from 'vitest';
import { classifyPlayerIntent, transitionAttitude } from '../src/npc/intentClassifier.ts';

describe('NPC intent classification & attitude transitions (NPC-AI-007, NPC-AI-008)', () => {
  describe('classifyPlayerIntent', () => {
    it('detects direct insults in Russian, English and Spanish', () => {
      expect(classifyPlayerIntent('ты дурак!')).toBe('insult');
      expect(classifyPlayerIntent('ты идиот')).toBe('insult');
      expect(classifyPlayerIntent('заткнись')).toBe('insult');
      expect(classifyPlayerIntent('you are an idiot')).toBe('insult');
      expect(classifyPlayerIntent('You are stupid')).toBe('insult');
      expect(classifyPlayerIntent('shut up!')).toBe('insult');
      expect(classifyPlayerIntent('eres un tonto')).toBe('insult');
      expect(classifyPlayerIntent('eres estúpido')).toBe('insult');
      expect(classifyPlayerIntent('cállate')).toBe('insult');
    });

    it('does NOT treat quotes as insults (S5 · NPC-AI-009)', () => {
      expect(classifyPlayerIntent('Он сказал «ты дурак»')).toBe('neutral');
      expect(classifyPlayerIntent('He said "you are stupid"')).toBe('neutral');
      expect(classifyPlayerIntent("someone said 'you idiot'")).toBe('neutral');
    });

    it('does NOT treat vocabulary inquiries as insults (S5 · NPC-AI-009)', () => {
      expect(classifyPlayerIntent('что значит дурак?')).toBe('neutral');
      expect(classifyPlayerIntent('что такое идиот?')).toBe('neutral');
      expect(classifyPlayerIntent('what does idiot mean?')).toBe('neutral');
      expect(classifyPlayerIntent('qué significa tonto?')).toBe('neutral');
    });

    it('does NOT treat third-party insults as insults to NPC (S5 · NPC-AI-009)', () => {
      expect(classifyPlayerIntent('царь дурак')).toBe('neutral');
      expect(classifyPlayerIntent('стражник идиот')).toBe('neutral');
      expect(classifyPlayerIntent('the king is bad and stupid')).toBe('neutral');
      expect(classifyPlayerIntent('el guardia es tonto')).toBe('neutral');
    });

    it('detects apologies in Russian, English and Spanish', () => {
      expect(classifyPlayerIntent('извини')).toBe('apology');
      expect(classifyPlayerIntent('прости меня пожалуйста')).toBe('apology');
      expect(classifyPlayerIntent('прошу прощения')).toBe('apology');
      expect(classifyPlayerIntent('I am sorry')).toBe('apology');
      expect(classifyPlayerIntent('sorry for that')).toBe('apology');
      expect(classifyPlayerIntent('I apologize')).toBe('apology');
      expect(classifyPlayerIntent('lo siento')).toBe('apology');
      expect(classifyPlayerIntent('perdón')).toBe('apology');
      expect(classifyPlayerIntent('disculpa')).toBe('apology');
    });

    it('treats normal, neutral, and curious questions as neutral', () => {
      expect(classifyPlayerIntent('Сколько стоит кувшин?')).toBe('neutral');
      expect(classifyPlayerIntent('How much is the barley?')).toBe('neutral');
      expect(classifyPlayerIntent('¿Cómo está el día hoy?')).toBe('neutral');
      expect(classifyPlayerIntent('Что такое телефон?')).toBe('neutral');
    });
  });

  describe('transitionAttitude', () => {
    it('insult transitions ordinary -> displeased', () => {
      expect(transitionAttitude('ordinary', 'insult')).toBe('displeased');
    });

    it('insult transitions friendly -> displeased', () => {
      expect(transitionAttitude('friendly', 'insult')).toBe('displeased');
    });

    it('repeated insult in displeased stays displeased without escalating (NPC-AI-008)', () => {
      expect(transitionAttitude('displeased', 'insult')).toBe('displeased');
    });

    it('apology in displeased returns to ordinary (NPC-AI-008)', () => {
      expect(transitionAttitude('displeased', 'apology')).toBe('ordinary');
    });

    it('repeated apology in ordinary does NOT grant friendly (NPC-AI-008)', () => {
      expect(transitionAttitude('ordinary', 'apology')).toBe('ordinary');
    });

    it('apology in friendly stays friendly', () => {
      expect(transitionAttitude('friendly', 'apology')).toBe('friendly');
    });

    it('server-confirmed help transitions ordinary to friendly (S6)', () => {
      expect(transitionAttitude('ordinary', 'help_confirmed')).toBe('friendly');
    });

    it('neutral intent keeps current attitude unchanged', () => {
      expect(transitionAttitude('ordinary', 'neutral')).toBe('ordinary');
      expect(transitionAttitude('displeased', 'neutral')).toBe('displeased');
      expect(transitionAttitude('friendly', 'neutral')).toBe('friendly');
    });
  });
});
