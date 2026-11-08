/**
 * Features that are built and tested but hidden from players. Flip a flag to bring a feature back;
 * nothing behind it is deleted. The server may still run the simulation: a hidden client ignores
 * its messages, sends none, and draws neither its UI nor its objects.
 */
/** Shotgun: reticle, ammo HUD, LMB/R input, target props and shot traces in the world. */
export const SHOTGUN_ENABLED = false;
