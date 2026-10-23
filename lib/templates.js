import { recordStore } from './record-store.js';
export const templateStore = (me, method, { body, id } = {}) => recordStore(me, 'templates', method, { body, query: { id } });
