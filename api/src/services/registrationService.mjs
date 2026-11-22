// Business rules for registrations: unknown event, duplicate email, full event.
import { cache, cacheKeys } from '../cache/index.mjs';
import { logger } from '../config/logger.mjs';
import { conflict, notFound } from '../errors/appError.mjs';
import { buildConfirmationMail, mailDispatcher } from '../mail/index.mjs';
import { notificationHub } from '../notifications/index.mjs';
import { eventRepository } from '../repositories/eventRepository.mjs';
import { registrationRepository } from '../repositories/registrationRepository.mjs';

const eventNotFound = (id) => notFound(`Event with id ${id} not found`);

async function requireEvent(eventId) {
  const event = await eventRepository.findById(eventId);
  if (!event) throw eventNotFound(eventId);
  return event;
}

async function assertNotRegistered(event, email) {
  if (await registrationRepository.findByEventAndEmail(event.id, email)) {
    throw conflict(`${email} is already registered for this event`);
  }
}

export const registrationService = {
  list(eventId) {
    return cache.wrap(cacheKeys.registrations(eventId), async () => {
      await requireEvent(eventId);
      return registrationRepository.listByEvent(eventId);
    });
  },

  async register(eventId, { name, email }) {
    const event = await requireEvent(eventId);
    await assertNotRegistered(event, email);

    // Registration + mail job are stored together. Whatever happens to the mail provider
    // from here on, the registration is safe. The seat check happens inside that same save,
    // so the last seat can never go to two people.
    const registration = await registrationRepository.createIfSeatLeft(
      { eventId, name, email },
      buildConfirmationMail(event, { name, email }),
      event.capacity
    );
    if (!registration) throw conflict('Event is full');
    logger.info('new registration', { event: event.title, name, email });

    cache.invalidate([cacheKeys.event(eventId), cacheKeys.registrations(eventId), cacheKeys.stats]);
    // Everyone may know that someone registered, never who: no name, no email.
    notificationHub.publish({ type: 'registration-created', eventId: event.id, title: event.title });
    mailDispatcher.kick(); // sends in the background; the response does not wait for it
    return registration;
  }
};