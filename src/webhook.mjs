import { eraseFamily } from './jobs.mjs';

// Clerk webhooks (signed by Svix; verified before this runs).
export async function handleClerkEvent(evt, { db, stores, log = console }) {
  const d = evt.data || {};
  switch (evt.type) {
    case 'user.deleted': {
      const fam = await db.withSystem(async c => (await c.query('SELECT id FROM families WHERE owner_user_id = $1', [d.id])).rows[0]);
      if (fam) await eraseFamily({ db, stores, familyId: fam.id, reason: 'clerk_user_deleted' });
      // A carer leaving only removes their membership.
      await db.withSystem(c => c.query('DELETE FROM family_members WHERE user_id = $1', [d.id]));
      return { handled: true, erased: !!fam };
    }
    // Co-parents and carers: a Clerk organisation per family.
    case 'organizationMembership.created': {
      const orgId = d.organization?.id, userId = d.public_user_data?.user_id;
      if (!orgId || !userId) return { handled: false };
      const r = await db.withSystem(c => c.query(
        `INSERT INTO family_members (family_id, user_id, role)
         SELECT id, $2, 'carer' FROM families WHERE clerk_org_id = $1
         ON CONFLICT DO NOTHING`, [orgId, userId]));
      return { handled: true, added: r.rowCount };
    }
    case 'organizationMembership.deleted': {
      const orgId = d.organization?.id, userId = d.public_user_data?.user_id;
      await db.withSystem(c => c.query(
        `DELETE FROM family_members WHERE role = 'carer' AND user_id = $2
           AND family_id IN (SELECT id FROM families WHERE clerk_org_id = $1)`, [orgId, userId]));
      return { handled: true };
    }
    case 'organization.created': {
      const owner = d.created_by;
      if (!owner) return { handled: false };
      await db.withSystem(c => c.query('UPDATE families SET clerk_org_id = $1 WHERE owner_user_id = $2 AND clerk_org_id IS NULL', [d.id, owner]));
      return { handled: true };
    }
    case 'session.created':
      return { handled: true }; // nothing stored: data minimisation
    default:
      log.info?.('ignored clerk event', evt.type);
      return { handled: false };
  }
}
