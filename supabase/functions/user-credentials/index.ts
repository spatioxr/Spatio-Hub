import { createClient } from 'npm:@supabase/supabase-js@2.106.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type CredentialAction = 'provision' | 'reset' | 'complete-temporary-password';

type EmployeeProfile = {
  id: string;
  auth_id: string | null;
  email: string;
  name: string;
  role: string;
  status: string;
  must_change_password: boolean;
  temporary_password_issued_at: string | null;
  temporary_password_issued_by: string | null;
};

class RequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const respond = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  },
);

const generateTemporaryPassword = () => (
  `Tmp!9aA-${crypto.randomUUID().replaceAll('-', '')}`
);

const isStrongPassword = (password: string) => (
  password.length >= 12
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password)
);

const requiredEnvironment = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new RequestError(500, 'SERVER_CONFIGURATION', `${name} is not configured.`);
  return value;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return respond({ error: 'Only POST is supported.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const anonKey = requiredEnvironment('SUPABASE_ANON_KEY');
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new RequestError(401, 'AUTH_REQUIRED', 'Sign in before managing credentials.');
    }

    const accessToken = authorization.slice('Bearer '.length);
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
    if (authError || !authData.user) {
      throw new RequestError(401, 'INVALID_SESSION', 'Your session is no longer valid.');
    }

    const { data: actor, error: actorError } = await adminClient
      .from('employees')
      .select(
        'id, auth_id, email, name, role, status, must_change_password, temporary_password_issued_at, temporary_password_issued_by',
      )
      .eq('auth_id', authData.user.id)
      .maybeSingle<EmployeeProfile>();

    if (actorError || !actor || actor.status !== 'Active') {
      throw new RequestError(403, 'ACTIVE_PROFILE_REQUIRED', 'An active employee profile is required.');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new RequestError(400, 'INVALID_JSON', 'Enter a valid credential request.');
    }

    const action = body.action as CredentialAction;

    if (action === 'complete-temporary-password') {
      if (!actor.must_change_password) {
        throw new RequestError(409, 'PASSWORD_CHANGE_NOT_REQUIRED', 'This account does not require a temporary-password change.');
      }

      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      if (!currentPassword) {
        throw new RequestError(400, 'CURRENT_PASSWORD_REQUIRED', 'Enter the temporary password.');
      }
      if (!isStrongPassword(newPassword)) {
        throw new RequestError(
          400,
          'WEAK_PASSWORD',
          'Use at least 12 characters with uppercase, lowercase, number, and symbol.',
        );
      }
      if (newPassword === currentPassword) {
        throw new RequestError(400, 'PASSWORD_UNCHANGED', 'Choose a password different from the temporary password.');
      }

      const verifier = createClient(supabaseUrl, anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      });
      const { data: verification, error: verificationError } = await verifier.auth.signInWithPassword({
        email: actor.email,
        password: currentPassword,
      });

      if (verificationError || verification.user?.id !== authData.user.id) {
        throw new RequestError(401, 'CURRENT_PASSWORD_INCORRECT', 'The temporary password is incorrect.');
      }

      await verifier.auth.signOut({ scope: 'local' });

      const { error: passwordError } = await adminClient.auth.admin.updateUserById(
        authData.user.id,
        { password: newPassword },
      );
      if (passwordError) {
        throw new RequestError(400, 'PASSWORD_UPDATE_FAILED', passwordError.message || 'Unable to change the password.');
      }

      const { data: clearedProfile, error: gateError } = await adminClient
        .from('employees')
        .update({ must_change_password: false })
        .eq('id', actor.id)
        .eq('must_change_password', true)
        .select('id')
        .maybeSingle<{ id: string }>();

      if (gateError || !clearedProfile) {
        throw new RequestError(
          500,
          'PASSWORD_CHANGED_GATE_FAILED',
          'The password changed, but portal activation did not finish. Retry using the new password as the current password.',
        );
      }

      return respond({ status: 'password_changed' });
    }

    if (!['provision', 'reset'].includes(action)) {
      throw new RequestError(400, 'INVALID_ACTION', 'Choose provision, reset, or complete-temporary-password.');
    }

    if (actor.role !== 'superadmin' || actor.must_change_password) {
      throw new RequestError(403, 'SUPERADMIN_REQUIRED', 'Only an active Superadmin can manage temporary passwords.');
    }

    const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    if (!employeeId) {
      throw new RequestError(400, 'EMPLOYEE_REQUIRED', 'Choose an employee.');
    }

    const { data: target, error: targetError } = await adminClient
      .from('employees')
      .select(
        'id, auth_id, email, name, role, status, must_change_password, temporary_password_issued_at, temporary_password_issued_by',
      )
      .eq('id', employeeId)
      .maybeSingle<EmployeeProfile>();

    if (targetError || !target) {
      throw new RequestError(404, 'EMPLOYEE_NOT_FOUND', 'Employee profile not found.');
    }
    if (target.status !== 'Active') {
      throw new RequestError(409, 'ACTIVE_TARGET_REQUIRED', 'Activate the employee before creating login credentials.');
    }
    if (target.id === actor.id) {
      throw new RequestError(409, 'SELF_RESET_NOT_ALLOWED', 'Use Change Password to update your own password.');
    }
    if (action === 'provision' && target.auth_id) {
      throw new RequestError(409, 'LOGIN_ALREADY_LINKED', 'This profile already has a login. Use Reset password instead.');
    }
    if (action === 'reset' && !target.auth_id) {
      throw new RequestError(409, 'LOGIN_NOT_LINKED', 'This profile has no login. Use Create login instead.');
    }

    const temporaryPassword = generateTemporaryPassword();

    if (action === 'provision') {
      let authUserId: string | null = null;
      let createdAuthUser = false;

      for (let page = 1; page <= 20 && !authUserId; page += 1) {
        const { data: userPage, error: listError } = await adminClient.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (listError) {
          throw new RequestError(502, 'AUTH_LOOKUP_FAILED', 'Unable to check existing Auth users.');
        }

        const matchingUser = userPage.users.find(
          (candidate) => candidate.email?.trim().toLowerCase() === target.email,
        );
        if (matchingUser) authUserId = matchingUser.id;
        if (userPage.users.length < 1000) break;
      }

      if (authUserId) {
        const { data: linkedProfile, error: linkedProfileError } = await adminClient
          .from('employees')
          .select('id')
          .eq('auth_id', authUserId)
          .maybeSingle<{ id: string }>();
        if (linkedProfileError) {
          throw new RequestError(502, 'AUTH_LINK_LOOKUP_FAILED', 'Unable to verify the existing Auth user link.');
        }
        if (linkedProfile && linkedProfile.id !== target.id) {
          throw new RequestError(409, 'AUTH_USER_ALREADY_LINKED', 'That email is already linked to another employee profile.');
        }
      } else {
        const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
          email: target.email,
          password: temporaryPassword,
          email_confirm: true,
        });
        if (createUserError || !createdUser.user) {
          throw new RequestError(502, 'AUTH_CREATE_FAILED', createUserError?.message || 'Unable to create the Auth user.');
        }
        authUserId = createdUser.user.id;
        createdAuthUser = true;
      }

      const { data: linkedEmployee, error: linkError } = await adminClient
        .from('employees')
        .update({
          auth_id: authUserId,
          must_change_password: true,
          temporary_password_issued_at: new Date().toISOString(),
          temporary_password_issued_by: actor.id,
        })
        .eq('id', target.id)
        .is('auth_id', null)
        .select('id')
        .maybeSingle<{ id: string }>();

      if (linkError || !linkedEmployee) {
        if (createdAuthUser && authUserId) {
          await adminClient.auth.admin.deleteUser(authUserId);
        }
        throw new RequestError(500, 'PROFILE_LINK_FAILED', 'Unable to link the new login to the employee profile.');
      }

      if (!createdAuthUser) {
        const { error: existingUserError } = await adminClient.auth.admin.updateUserById(
          authUserId as string,
          { password: temporaryPassword, email_confirm: true },
        );
        if (existingUserError) {
          const { error: rollbackError } = await adminClient
            .from('employees')
            .update({
              auth_id: null,
              must_change_password: target.must_change_password,
              temporary_password_issued_at: target.temporary_password_issued_at,
              temporary_password_issued_by: target.temporary_password_issued_by,
            })
            .eq('id', target.id)
            .eq('auth_id', authUserId as string);

          if (rollbackError) {
            throw new RequestError(
              500,
              'AUTH_UPDATE_ROLLBACK_FAILED',
              'The Auth update failed and the profile link could not be restored. Retry Reset password for this employee.',
            );
          }
          throw new RequestError(502, 'AUTH_UPDATE_FAILED', 'Unable to prepare the existing Auth user.');
        }
      }

      return respond({
        status: 'provisioned',
        employeeId: target.id,
        temporaryPassword,
      });
    }

    const previousGate = {
      must_change_password: target.must_change_password,
      temporary_password_issued_at: target.temporary_password_issued_at,
      temporary_password_issued_by: target.temporary_password_issued_by,
    };
    const { data: gatedEmployee, error: gateError } = await adminClient
      .from('employees')
      .update({
        must_change_password: true,
        temporary_password_issued_by: actor.id,
      })
      .eq('id', target.id)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (gateError || !gatedEmployee) {
      throw new RequestError(500, 'PASSWORD_GATE_FAILED', 'Unable to require a password change for this employee.');
    }

    const { error: resetError } = await adminClient.auth.admin.updateUserById(
      target.auth_id as string,
      { password: temporaryPassword },
    );
    if (resetError) {
      await adminClient.from('employees').update(previousGate).eq('id', target.id);
      throw new RequestError(502, 'AUTH_RESET_FAILED', resetError.message || 'Unable to reset the Auth password.');
    }

    const { error: timestampError } = await adminClient
      .from('employees')
      .update({
        must_change_password: true,
        temporary_password_issued_at: new Date().toISOString(),
        temporary_password_issued_by: actor.id,
      })
      .eq('id', target.id);

    return respond({
      status: 'reset',
      employeeId: target.id,
      temporaryPassword,
      warning: timestampError
        ? 'Password reset succeeded, but its audit timestamp could not be saved.'
        : null,
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return respond({ error: error.message, code: error.code }, error.status);
    }

    return respond(
      { error: 'Unable to complete the credential request.', code: 'UNEXPECTED_ERROR' },
      500,
    );
  }
});
