import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

// Feedback week 3: "last seat sold twice". An event must never get more registrations than seats,
// not one by one and not when several people press "Register" at the same moment.
describe('registering for the last seat', () => {
  let app;

  beforeEach(async () => {
    ({ app } = await createTestApp());
  });

  const createEvent = async (capacity) => (await request(app).post('/api/events').send(validEvent({ capacity }))).body;
  const register = (eventId, n) =>
    request(app).post(`/api/events/${eventId}/registrations`).send({ name: `Person ${n}`, email: `person${n}@example.com` });

  it('refuses the next person once every seat is taken', async () => {
    const event = await createEvent(2);
    await register(event.id, 1);
    await register(event.id, 2);

    const third = await register(event.id, 3);

    assert.equal(third.status, 409);
    assert.equal(third.body.error.message, 'Event is full');
    const detail = await request(app).get(`/api/events/${event.id}`);
    assert.equal(detail.body.registered, 2);
    assert.equal(detail.body.spotsLeft, 0);
  });

  it('gives the last seat to exactly one person when several register at the same moment', async () => {
    const event = await createEvent(1);

    const responses = await Promise.all([1, 2, 3, 4, 5].map((n) => register(event.id, n)));

    const statuses = responses.map((res) => res.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
    const registrations = await request(app).get(`/api/events/${event.id}/registrations`);
    assert.equal(registrations.body.length, 1);
  });
});
