export async function subscribeToAdminComplaints({
  user,
  db,
  firestoreApi,
  onComplaints,
  onError,
  isActive = () => true
}) {
  const tokenResult = await user.getIdTokenResult(true);
  if (!isActive()) return () => {};

  if (tokenResult.claims.admin !== true) {
    onError({code:'permission-denied'});
    return () => {};
  }

  const complaintsQuery = firestoreApi.query(
    firestoreApi.collection(db, 'complaints'),
    firestoreApi.orderBy('createdAt', 'desc'),
    firestoreApi.limit(500)
  );
  const unsubscribeSnapshot = firestoreApi.onSnapshot(complaintsQuery, (snapshot) => {
    const documentsById = new Map();
    for (const document of snapshot.docs) {
      documentsById.set(document.id, {...document.data(), id:document.id});
    }
    onComplaints([...documentsById.values()]);
  }, onError);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribeSnapshot();
  };
}
