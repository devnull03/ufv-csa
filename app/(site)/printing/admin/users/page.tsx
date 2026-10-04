import { desc, eq } from "drizzle-orm";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { DiscordUserChip, PrintQHeader } from "~/app/printq/components/shared";
import { db, schema } from "~/app/printq/db/client";
import { formatDateTime } from "~/app/printq/format";
import { requireRolePage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

// DESIGN_BRIEF §4.12
export default async function UsersPage() {
  await requireRolePage("admin", "/printing/admin/users");
  const users = await db()
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      username: schema.profiles.discordUsername,
      role: schema.profiles.role,
      isGuildMember: schema.profiles.isGuildMember,
      hasVerifiedRole: schema.profiles.hasVerifiedRole,
      checkedAt: schema.profiles.eligibilityCheckedAt,
      bannedUntil: schema.profiles.bannedUntil,
    })
    .from(schema.user)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.user.id))
    .orderBy(desc(schema.user.createdAt))
    .limit(500);

  return (
    <>
      <PrintQHeader title="Users" />
      <Placeholder name="UsersTable + RoleSelect + BanDialog" spec="§4.12">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>In server</th>
              <th>Verified</th>
              <th>Last checked</th>
              <th>Banned until</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <DiscordUserChip name={user.name} username={user.username} image={user.image} />
                </td>
                <td>{user.role}</td>
                <td>{user.isGuildMember ? "✓" : "✗"}</td>
                <td>{user.hasVerifiedRole ? "✓" : "✗"}</td>
                <td>{user.checkedAt ? formatDateTime(user.checkedAt) : "–"}</td>
                <td>{user.bannedUntil ? formatDateTime(user.bannedUntil) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Placeholder>
    </>
  );
}
