// Every feature of this build, in nav order. Adding a feature = one import
// here; everything else lives in its folder (see ./types.ts).
import type { Feature } from "./types";
import dashboard from "./dashboard";
import tasks from "./tasks";
import records from "./records";
import search from "./search";
import automations from "./automations";
import forms from "./forms";
import integrations from "./integrations";
import assistant from "./assistant";
import settings from "./settings";
import setup from "./setup";
import reports from "./reports";
import deals from "./deals";
import customize from "./customize";

export const FEATURES: Feature[] = [dashboard, tasks, records, deals, reports, search, automations, forms, integrations, assistant, customize, settings, setup];

export type { Feature } from "./types";
