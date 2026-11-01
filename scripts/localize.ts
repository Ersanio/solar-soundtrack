/**
 * What the page's build does to every message, done at run time instead: defines `$localize` and
 * loads the English from web/src/locale/messages.en.json, so a message reads as a porter sees it
 * rather than as its ID. Every harness imports this before anything that builds a message.
 */
import "@angular/localize/init";
import { loadTranslations } from "@angular/localize";
import english from "../web/src/locale/messages.en.json";

loadTranslations(english.translations);
