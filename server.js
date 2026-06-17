const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Serve Static Frontend Files (HTML, CSS, JS, Images)
app.use(express.static(path.join(__dirname), {
    index: 'index.html',
    extensions: ['html']
}));

// Block access to sensitive files
app.use((req, res, next) => {
    if (req.url.includes('.env') || req.url === '/server.js' || req.url === '/make_offline.js') {
        return res.status(403).send("Forbidden");
    }
    next();
});

// ==========================================
// 1. DATABASE CONNECTION
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("Connected to RAVN Database! 🚀");
        
        // --- ADD THIS SEEDER BLOCK ---
        const adminCount = await AdminUser.countDocuments();
        if (adminCount === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await AdminUser.create({
                email: 'admin@ravn.io',
                passwordHash: hash,
                role: 'Core'
            });
            console.log("🌱 Default Admin Created! -> Email: admin@ravn.io | Password: admin123");
        }
        // ------------------------------
    })
    .catch(err => console.error("Database connection failed:", err));

// ==========================================
// 2. EMAILJS CONFIGURATION
// ==========================================
// Native fetch to EmailJS REST API (No extra npm packages needed in Node 18+)
const sendViaEmailJS = async (toEmail, subject, htmlContent) => {
    try {
        const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID,
                template_id: process.env.EMAILJS_TEMPLATE_ID,
                user_id: process.env.EMAILJS_PUBLIC_KEY,
                accessToken: process.env.EMAILJS_PRIVATE_KEY, // Optional, depending on your EmailJS security settings
                template_params: {
                    to_email: toEmail,
                    subject: subject,
                    // CRITICAL: In your EmailJS template on their website, you MUST use {{{message}}} 
                    // (with 3 brackets) so it renders this HTML instead of printing raw code.
                    message: htmlContent 
                }
            })
        });
        if (!response.ok) {
            const text = await response.text();
            console.error("EmailJS Error:", text);
        } else {
            console.log(`📧 Email sent via EmailJS to ${toEmail}`);
        }
    } catch (error) {
        console.error("❌ EmailJS Dispatch Failed:", error);
    }
};

// ==========================================
// 2.5 RAZORPAY CONFIGURATION
// ==========================================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'secret_mock'
});

// ==========================================
// 3. DATABASE SCHEMAS
// ==========================================
const memberSchema = new mongoose.Schema({
    name: String, email: String, phone: String, age: Number, gender: String, address: String, 
    memberId: { type: String, unique: true }, passwordHash: String, paymentStatus: { type: String, default: 'Pending' }, 
    paymentMethod: String, paymentVerified: { type: Boolean, default: false }, clearanceLevel: { type: Number, default: 1 }, 
    attendanceCount: { type: Number, default: 0 }, profilePic: String, joinedAt: { type: Date, default: Date.now }
});

const eventSchema = new mongoose.Schema({
    title: String, description: String, date: String, venue: String, capacity: Number, isPayable: Boolean, 
    eventFee: Number, isMembersOnly: Boolean, visibility: { type: String, enum: ['Public', 'Unlisted'], default: 'Public' }, 
    rsvpOpen: { type: Boolean, default: true }, tiers: [{ name: String, price: Number }], 
    attendees: [{
        name: String, email: String, phone: String, memberId: String, tier: String, 
        status: { type: String, default: 'Pending' }, utr: String, registeredAt: { type: Date, default: Date.now }
    }],
    waitlist: [{ name: String, email: String, phone: String, memberId: String, addedAt: { type: Date, default: Date.now } }],
    resources: [{ title: String, url: String }] 
});

const messageSchema = new mongoose.Schema({
    name: String, email: String, type: String, message: String, status: { type: String, default: 'Pending' }, date: { type: Date, default: Date.now }
});

const notificationSchema = new mongoose.Schema({
    title: String, message: String, imageUrl: String, timestamp: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
    registrationOpen: { type: Boolean, default: true }, freePromoActive: { type: Boolean, default: false }, 
    membershipFee: { type: Number, default: 500 }, upiId: { type: String, default: 'ravn@bank' }
});

const adminUserSchema = new mongoose.Schema({
    email: String, passwordHash: String, role: { type: String, enum: ['Core', 'Finance', 'Media'], default: 'Media' }
});

const Member = mongoose.model('Member', memberSchema);
const Event = mongoose.model('Event', eventSchema);
const Message = mongoose.model('Message', messageSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const AdminUser = mongoose.model('AdminUser', adminUserSchema);

// ==========================================
// 4. AUTHENTICATION MIDDLEWARE
// ==========================================
const verifyToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if (!bearerHeader) return res.status(403).json({ error: "Access Denied" });
    const token = bearerHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Invalid Token" });
        req.adminRole = decoded.role;
        next();
    });
};

// ==========================================
// 5. PUBLIC ROUTES
// ==========================================
app.get('/api/public/settings', async (req, res) => {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json({ settings });
});

app.get('/api/public/events', async (req, res) => {
    try {
        const events = await Event.find({ visibility: 'Public' }).sort({ date: 1 });
        res.json(events);
    } catch(e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/api/public/events/:id', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if(!event) return res.status(404).json({ error: "Event not found" });
        res.json(event);
    } catch(e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/api/public/notifications', async (req, res) => {
    try {
        const notifications = await Notification.find().sort({ timestamp: -1 });
        res.json(notifications);
    } catch(e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/contact', async (req, res) => {
    try {
        const newMessage = new Message(req.body);
        await newMessage.save();

        const htmlEmail = `
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${req.body.name}</p>
            <p><strong>Email:</strong> ${req.body.email}</p>
            <p><strong>Topic:</strong> ${req.body.type}</p>
            <p><strong>Message:</strong><br/>${req.body.message}</p>
        `;
        // Send to Admin Team (Replace with your actual admin email)
        await sendViaEmailJS('admin@ravn.club', `New Message: ${req.body.type}`, htmlEmail);

        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to save message" }); }
});

// ==========================================
// 6. REGISTRATION & EVENT RSVP
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        if (settings && !settings.registrationOpen) return res.status(403).json({ error: "Registrations are closed." });

        const memberId = 'RVN-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const isFree = req.body.paymentMethod.includes('Free');
        
        const newMember = new Member({
            ...req.body,
            memberId,
            paymentStatus: isFree ? 'Paid' : 'Pending',
            paymentVerified: isFree
        });
        await newMember.save();

        if (isFree) {
            const htmlEmail = `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Welcome to RAVN, ${newMember.name}! 🎉</h2>
                    <p>Your Member ID is: <strong style="color: #FF6B6B;">${memberId}</strong></p>
                    <p>Use this ID to log into the Clubhouse Portal and set up your password.</p>
                </div>
            `;
            await sendViaEmailJS(newMember.email, 'Welcome to the Family!', htmlEmail);
            res.json({ success: true, memberId });
        } else {
            const amount = (settings.membershipFee || 500) * 100;
            const order = await razorpay.orders.create({ amount: amount, currency: "INR", receipt: memberId });
            res.json({ success: true, pending: true, order, memberId, key: process.env.RAZORPAY_KEY_ID });
        }
    } catch(e) { res.status(500).json({ error: "Registration failed." }); }
});

app.post('/api/register/verify', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, memberId } = req.body;
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body.toString()).digest('hex');

        if (expectedSignature === razorpay_signature) {
            const member = await Member.findOneAndUpdate({ memberId }, { paymentStatus: 'Paid', paymentMethod: 'Razorpay', paymentVerified: true });
            const htmlEmail = `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Welcome to RAVN, ${member.name}! 🎉</h2>
                    <p>Your payment was successful!</p>
                    <p>Your Member ID is: <strong style="color: #FF6B6B;">${memberId}</strong></p>
                    <p>Use this ID to log into the Clubhouse Portal and set up your password.</p>
                </div>
            `;
            await sendViaEmailJS(member.email, 'Welcome to the Family!', htmlEmail);
            res.json({ success: true, memberId });
        } else {
            res.status(400).json({ error: "Invalid payment signature" });
        }
    } catch(e) { res.status(500).json({ error: "Verification failed." }); }
});

app.post('/api/public/events/:id/rsvp', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if(!event) return res.status(404).json({ error: "Event not found" });

        const existingRSVP = event.attendees.find(a => a.email.toLowerCase() === req.body.email.toLowerCase());
        if(existingRSVP) return res.status(400).json({ error: "You have already registered for this event!" });

        if (event.attendees.length >= event.capacity) {
            event.waitlist.push(req.body);
            await event.save();
            return res.json({ waitlist: true });
        }

        const isPayable = event.isPayable;
        const attendeeRecord = { ...req.body, status: isPayable ? 'Pending' : 'Verified' };
        event.attendees.push(attendeeRecord);
        await event.save();
        
        const newAttendee = event.attendees[event.attendees.length - 1];

        if (!isPayable) {
            const refId = `REF-${Math.floor(Math.random()*10000)}`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent((req.body.memberId || req.body.email) + '-' + event._id + '-' + refId)}`;
            const htmlEmail = `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Event Pass: ${event.title} 🎟️</h2>
                    <p>Hi ${req.body.name}, your spot is saved!</p>
                    <img src="${qrUrl}" alt="QR Code" style="width: 200px; height: 200px; border-radius: 12px;" />
                    <p><strong>Status:</strong> ${newAttendee.status}</p>
                </div>
            `;
            await sendViaEmailJS(req.body.email, `Your Pass for ${event.title}`, htmlEmail);
            res.json({ success: true, refId, qrUrl });
        } else {
            let fee = event.eventFee;
            if (event.tiers && event.tiers.length > 0 && req.body.tier) {
                const tier = event.tiers.find(t => t.name === req.body.tier);
                if (tier) fee = tier.price;
            }
            const order = await razorpay.orders.create({ amount: fee * 100, currency: "INR", receipt: newAttendee._id.toString() });
            res.json({ success: true, pending: true, order, attendeeId: newAttendee._id, key: process.env.RAZORPAY_KEY_ID });
        }
    } catch(e) { res.status(500).json({ error: "RSVP failed." }); }
});

app.post('/api/public/events/:id/rsvp/verify', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, attendeeId } = req.body;
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body.toString()).digest('hex');

        if (expectedSignature === razorpay_signature) {
            const event = await Event.findById(req.params.id);
            const attendee = event.attendees.id(attendeeId);
            
            attendee.status = 'Verified';
            attendee.utr = razorpay_payment_id;
            await event.save();
            
            const refId = `REF-${Math.floor(Math.random()*10000)}`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent((attendee.memberId || attendee.email) + '-' + event._id + '-' + refId)}`;
            const htmlEmail = `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Event Pass: ${event.title} 🎟️</h2>
                    <p>Hi ${attendee.name}, payment successful! Your spot is saved.</p>
                    <img src="${qrUrl}" alt="QR Code" style="width: 200px; height: 200px; border-radius: 12px;" />
                    <p><strong>Status:</strong> Verified</p>
                </div>
            `;
            await sendViaEmailJS(attendee.email, `Your Pass for ${event.title}`, htmlEmail);
            res.json({ success: true, refId, qrUrl });
        } else {
            res.status(400).json({ error: "Invalid payment signature" });
        }
    } catch(e) { res.status(500).json({ error: "Verification failed." }); }
});

// ==========================================
// 7. MEMBER PORTAL ROUTES
// ==========================================
app.get('/api/member/:id', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.params.id + '$', 'i') });
        if(!member) return res.status(404).json({ error: "Member not found" });
        res.json({ member, hasPassword: !!member.passwordHash });
    } catch(e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/member/login', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.body.memberId + '$', 'i') });
        if (!member || !member.passwordHash) return res.status(401).json({ error: "Invalid credentials" });

        const isMatch = await bcrypt.compare(req.body.password, member.passwordHash);
        if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

        res.json({ success: true, member });
    } catch(e) { res.status(500).json({ error: "Login failed" }); }
});

app.put('/api/member/:id/password', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await Member.findOneAndUpdate({ memberId: req.params.id }, { passwordHash: hash });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to set password" }); }
});

app.put('/api/member/:id/profile', async (req, res) => {
    try {
        const { phone, address, profilePic } = req.body;
        await Member.findOneAndUpdate({ memberId: req.params.id }, { phone, address, profilePic });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to update profile" }); }
});

app.get('/api/member/:id/events', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.params.id + '$', 'i') });
        if(!member) return res.status(404).json({ error: "Member not found" });
        
        const safeEmail = member.email ? member.email.toLowerCase() : 'no-email-set';
        const events = await Event.find({ attendees: { $elemMatch: { $or: [{ memberId: member.memberId }, { email: safeEmail }] } } });
        res.json(events);
    } catch(e) { res.status(500).json({ error: "Failed to fetch events" }); }
});

app.delete('/api/member/:id/events/:eventId/rsvp', async (req, res) => {
    try {
        const event = await Event.findById(req.params.eventId);
        if(!event) return res.status(404).json({ error: "Event not found" });

        event.attendees = event.attendees.filter(a => a.memberId !== req.params.id);

        if (event.waitlist.length > 0 && event.attendees.length < event.capacity) {
            const nextInLine = event.waitlist.shift();
            event.attendees.push({ ...nextInLine, status: 'Verified' });
            
            const htmlEmail = `<p>Good news ${nextInLine.name}! A spot opened up for ${event.title} and you're in! 🎉</p>`;
            await sendViaEmailJS(nextInLine.email, `You're off the waitlist!`, htmlEmail);
        }

        await event.save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Cancellation failed" }); }
});

app.get('/api/member/:id/vault', async (req, res) => {
    try {
        const member = await Member.findOne({ memberId: new RegExp('^' + req.params.id + '$', 'i') });
        const events = await Event.find({ attendees: { $elemMatch: { memberId: member.memberId, status: 'Verified' } }, "resources.0": { $exists: true } });
        res.json(events.map(e => ({ title: e.title, date: e.date, resources: e.resources })));
    } catch(e) { res.status(500).json({ error: "Failed to fetch vault" }); }
});

// ==========================================
// 8. ADMIN ROUTES & WEBHOOKS
// ==========================================
app.post('/api/admin/login', async (req, res) => {
    try {
        const admin = await AdminUser.findOne({ email: req.body.email });
        if (!admin) return res.status(401).json({ error: "Invalid credentials" });

        const isMatch = await bcrypt.compare(req.body.password, admin.passwordHash);
        if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

        const token = jwt.sign({ id: admin._id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token, role: admin.role });
    } catch(e) { res.status(500).json({ error: "Login failed" }); }
});

app.get('/api/admin/data', verifyToken, async (req, res) => {
    try {
        const members = await Member.find().sort({ joinedAt: -1 });
        const events = await Event.find().sort({ date: -1 });
        const messages = await Message.find().sort({ date: -1 });
        const notifications = await Notification.find().sort({ timestamp: -1 });
        const settings = await Settings.findOne() || {};

        res.json({
            members, events, messages, notifications, settings,
            statistics: {
                totalMembers: members.length,
                pendingMembers: members.filter(m => m.paymentStatus === 'Pending').length,
                revenue: members.filter(m => m.paymentStatus === 'Paid').length * (settings.membershipFee || 500),
                totalRSVPs: events.reduce((acc, e) => acc + e.attendees.length, 0)
            }
        });
    } catch(e) { res.status(500).json({ error: "Server Error" }); }
});

app.put('/api/admin/settings', verifyToken, async (req, res) => {
    try {
        const updatedSettings = await Settings.findOneAndUpdate({}, { $set: req.body }, { new: true, upsert: true });
        res.json({ success: true, settings: updatedSettings });
    } catch(e) { res.status(500).json({ error: "Failed to update settings" }); }
});

app.put('/api/admin/members/:id', verifyToken, async (req, res) => {
    try {
        const updatedMember = await Member.findOneAndUpdate({ memberId: req.params.id }, { $set: req.body }, { new: true });
        res.json({ success: true, member: updatedMember });
    } catch(e) { res.status(500).json({ error: "Failed to update member" }); }
});

app.delete('/api/admin/members/:id', verifyToken, async (req, res) => {
    try {
        await Member.findOneAndDelete({ memberId: req.params.id });
        await Event.updateMany({}, { $pull: { attendees: { memberId: req.params.id } } });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to delete member" }); }
});

app.post('/api/admin/events', verifyToken, async (req, res) => {
    try {
        const newEvent = new Event(req.body);
        await newEvent.save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to create event" }); }
});

app.put('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
        const updatedEvent = await Event.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
        res.json({ success: true, event: updatedEvent });
    } catch(e) { res.status(500).json({ error: "Failed to update event" }); }
});

app.delete('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to delete event" }); }
});

app.put('/api/admin/events/:id/toggle', verifyToken, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        event.rsvpOpen = !event.rsvpOpen;
        await event.save();
        res.json({ success: true, rsvpOpen: event.rsvpOpen });
    } catch(e) { res.status(500).json({ error: "Failed to toggle status" }); }
});

app.get('/api/admin/events/:id/attendees', verifyToken, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        res.json({ attendees: event.attendees, waitlist: event.waitlist });
    } catch(e) { res.status(500).json({ error: "Failed to fetch attendees" }); }
});

app.put('/api/admin/events/:eventId/verify/:subId', verifyToken, async (req, res) => {
    try {
        await Event.updateOne(
            { _id: req.params.eventId, "attendees._id": req.params.subId },
            { $set: { "attendees.$.status": "Verified" } }
        );
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Verification failed" }); }
});

app.post('/api/admin/events/:id/resources', verifyToken, async (req, res) => {
    try {
        await Event.findByIdAndUpdate(req.params.id, { $push: { resources: req.body } });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to add resource" }); }
});

app.post('/api/admin/scan', verifyToken, async (req, res) => {
    try {
        const parts = req.body.qrData.split('-');
        if (parts.length < 3) return res.status(400).json({ error: "Invalid QR format" });

        const memberId = `${parts[0]}-${parts[1]}`;
        const eventId = parts[2];

        const event = await Event.findById(eventId);
        if(!event) return res.status(404).json({ error: "Event not found" });

        const attendeeIndex = event.attendees.findIndex(a => a.memberId === memberId);
        if(attendeeIndex === -1) return res.status(404).json({ error: "Guest not on the list!" });

        const attendee = event.attendees[attendeeIndex];
        const memberProfile = await Member.findOne({ memberId });

        if (req.body.scanType === 'ENTRY') {
            if (attendee.status === 'Pending') return res.status(400).json({ error: "Payment not verified yet." });
            if (attendee.status === 'Scanned') return res.status(400).json({ error: "Pass already used!" });
            
            event.attendees[attendeeIndex].status = 'Scanned';
            await event.save();
            
            if (memberProfile) {
                memberProfile.attendanceCount += 1;
                await memberProfile.save();
            }
            return res.json({ success: true, type: "Entry Permitted", message: "Ticket verified.", member: memberProfile });
        } else {
            return res.json({ success: true, type: "Perk Claimed", message: "Lunch/perk logged.", member: memberProfile });
        }
    } catch(e) { res.status(500).json({ error: "Scan processing failed" }); }
});

app.get('/api/admin/users', verifyToken, async (req, res) => {
    try {
        const users = await AdminUser.find().select('-passwordHash');
        res.json(users);
    } catch(e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/admin/users', verifyToken, async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.passwordHash, 10);
        const newUser = new AdminUser({ ...req.body, passwordHash: hash });
        await newUser.save();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to create user" }); }
});

app.delete('/api/admin/users/:id', verifyToken, async (req, res) => {
    try {
        await AdminUser.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to delete user" }); }
});

app.post('/api/admin/notifications', verifyToken, async (req, res) => {
    try {
        const newNotif = new Notification(req.body);
        await newNotif.save();

        if (req.body.triggerBlast) {
            const htmlEmail = `<div style="padding: 20px;"><h2>${req.body.title}</h2><p>${req.body.message}</p></div>`;
            await sendViaEmailJS("all-members@yourclub.com", `Community Broadcast: ${req.body.title}`, htmlEmail);
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to broadcast" }); }
});

app.put('/api/admin/notifications/:id', verifyToken, async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, { $set: req.body });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to update message" }); }
});

app.delete('/api/admin/notifications/:id', verifyToken, async (req, res) => {
    try {
        await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Failed to delete message" }); }
});

// SMS WEBHOOK FOR MANUAL UPI
app.post('/api/admin/webhook/sms', async (req, res) => {
    try {
        const webhookSecret = req.query.secret;
        if (webhookSecret !== (process.env.WEBHOOK_SECRET || 'ravn_auto_123')) {
            return res.status(401).json({ error: "Unauthorized webhook access" });
        }
        const { message, sender } = req.body; 
        if (!message) return res.status(400).json({ error: "No message payload received" });

        const utrMatch = message.match(/\b\d{12}\b/);
        if (!utrMatch) return res.status(200).json({ status: "ignored", reason: "No UTR found" });

        const extractedUtr = utrMatch[0];
        const pendingMember = await Member.findOne({ paymentMethod: { $regex: extractedUtr }, paymentVerified: false });

        if (!pendingMember) return res.status(200).json({ status: "ignored", reason: "No matching pending member" });

        pendingMember.paymentVerified = true;
        await pendingMember.save();

        const htmlEmail = `
            <h1>Payment Auto-Verified! 🎉</h1>
            <p>Hey ${pendingMember.name}, we just received your UPI payment (Ref: ${extractedUtr}).</p>
            <p>Your Member ID is: <strong>${pendingMember.memberId}</strong></p>
            <p>Log in to the Clubhouse to see upcoming events!</p>
        `;
        await sendViaEmailJS(pendingMember.email, `Welcome to RAVN, ${pendingMember.name}!`, htmlEmail);

        return res.status(200).json({ success: true, message: "Member auto-verified successfully!", memberId: pendingMember.memberId });
    } catch (error) {
        console.error("[UPI Webhook Error]:", error);
        res.status(500).json({ error: "Webhook processing failed" });
    }
});

// ==========================================
// 9. START SERVER
// ==========================================
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`RAVN Backend securely running on port ${PORT} 🛡️`));