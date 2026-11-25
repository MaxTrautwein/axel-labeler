import { Routes } from '@angular/router';

import { Settings } from './settings/settings';
import { Workspace } from './workspace/workspace';

export const routes: Routes = [
  { path: '', component: Workspace },
  { path: 'v/:id', component: Workspace },
  { path: 'settings', component: Settings },
  { path: '**', redirectTo: '' },
];
