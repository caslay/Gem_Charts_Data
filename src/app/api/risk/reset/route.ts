import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { GlobalRiskGovernor } from '@/lib/risk/GlobalRiskGovernor';

export async function POST() {
  try {
    const session = await auth();
    const userEmail = session?.user?.email || 'institutional_admin';

    await GlobalRiskGovernor.resetCircuitBreaker(userEmail);

    return NextResponse.json({
      success: true,
      message: 'Circuit breaker reset successfully. Automated execution re-armed.',
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[API_RISK_RESET_ERROR]', error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
