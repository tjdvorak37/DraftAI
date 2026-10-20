import { createClient } from '@supabase/supabase-js';
import { createWorkspaceHandler } from '../_shared/api.js';

Deno.serve(createWorkspaceHandler({ createClient, env: (name: string) => Deno.env.get(name) }));