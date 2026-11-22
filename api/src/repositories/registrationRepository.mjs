import { col, fn } from 'sequelize';
import { sequelize } from '../db/connection.mjs';
import { MailJob, Registration } from '../models/index.mjs';

const plain = (row) => (row ? row.toJSON() : null);

// SQLite lets one writer in at a time, and with the in-memory test database all queries even share one
// connection. So registrations wait in line: each one counts and saves before the next one starts.
// This works for one server process; with several instances you would lock the event row in the
// database instead (e.g. SELECT ... FOR UPDATE in Postgres).
let queue = Promise.resolve();
function oneAtATime(work) {
  const result = queue.then(work);
  queue = result.catch(() => {}); // a failed registration must not block the ones after it
  return result;
}

export const registrationRepository = {
  async listByEvent(eventId) {
    const rows = await Registration.findAll({ where: { eventId }, order: [['createdAt', 'ASC']] });
    return rows.map(plain);
  },

  countByEvent(eventId) {
    return Registration.count({ where: { eventId } });
  },

  async findByEventAndEmail(eventId, email) {
    return plain(await Registration.findOne({ where: { eventId, email } }));
  },

  // One query for all events: Map of eventId -> number of registrations.
  async countsPerEvent() {
    const rows = await Registration.findAll({
      attributes: ['eventId', [fn('COUNT', col('id')), 'total']],
      group: ['eventId'],
      raw: true
    });
    return new Map(rows.map((row) => [row.eventId, Number(row.total)]));
  },

  // Saves the registration and its confirmation mail, but only while a seat is left. Returns null when
  // the event is full. Counting and saving happen in ONE transaction, and registrations take turns
  // (see oneAtATime), so two people can never both get the last seat.
  createIfSeatLeft(registration, mail, capacity) {
    return oneAtATime(() =>
      sequelize.transaction(async (transaction) => {
        const taken = await Registration.count({ where: { eventId: registration.eventId }, transaction });
        if (taken >= capacity) return null;

        const created = await Registration.create(registration, { transaction });
        await MailJob.create({ ...mail, registrationId: created.id }, { transaction });
        return plain(created);
      })
    );
  }
};
