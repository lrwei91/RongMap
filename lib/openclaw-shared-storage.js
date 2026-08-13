const sharedStore = require('./shared-store');
const { getServiceIdentity } = require('./server-supabase');

async function getLocations() {
  const identity = await getServiceIdentity();
  return (await sharedStore.bootstrap(identity)).locations;
}

async function createLocation(input) {
  const identity = await getServiceIdentity();
  try {
    const location = await sharedStore.createLocation(identity, input);
    return { success: true, status: 'saved', location };
  } catch (error) {
    if (error.status === 409) {
      return { success: false, status: 'duplicate', message: '地点已存在', existing: error.existing };
    }
    throw error;
  }
}

module.exports = { getLocations, createLocation };
