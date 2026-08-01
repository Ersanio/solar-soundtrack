import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';

/**
 * No `provideZonelessChangeDetection()` here on purpose: this workspace was
 * scaffolded `--zoneless`, so zone.js is not a dependency at all and zoneless is
 * the default. Nothing to opt into.
 *
 * The router is likewise absent — the editor is a single view. Adding one later
 * is `provideRouter(routes)` plus an outlet.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
