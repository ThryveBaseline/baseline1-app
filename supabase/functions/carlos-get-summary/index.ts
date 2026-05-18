// carlos-get-summary — multi-table health data query for Carlos agent.
// Called by carlos-tools.js when get_weekly_summary needs complex aggregation.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const { brand = 'Thryve', lookback_days = 14 } = await req.json().catch(() => ({}));
    const since = new Date(Date.now() - lookback_days * 86400000).toISOString().split('T')[0];

    // Weekly snapshots
    const { data: snapshots } = await supabase
      .from('business_weekly_snapshots')
      .select('*')
      .eq('brand', brand)
      .gte('week_start', since)
      .order('week_start', { ascending: false })
      .limit(4);

    // Health context summary
    const { data: health } = await supabase
      .from('daily_health_context')
      .select('date, recovery_score, hrv_ms, sleep_hours, day_strain, health_summary')
      .eq('user_id', 'primary')
      .eq('provider', 'whoop')
      .gte('date', since)
      .order('date', { ascending: false })
      .limit(14);

    // Recent food logs
    const { data: food } = await supabase
      .from('food_logs')
      .select('raw_text, items, created_at')
      .eq('user_id', 'primary')
      .gte('created_at', new Date(Date.now() - 3 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    const avgRecovery = health && health.length > 0
      ? Math.round(health.reduce((s: number, r: any) => s + (r.recovery_score || 0), 0) / health.length)
      : null;

    return new Response(
      JSON.stringify({ snapshots, health, food, avg_recovery: avgRecovery }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
